"""Evaluate the trained checkpoint and every ONNX variant on held-out text.

Perplexity is the standard number, but it is not the number a user of an
autocomplete feels. What they feel is: was the word I wanted in the list. So
this reports top-1/3/5 accuracy alongside perplexity, for the torch model and
for each exported variant, and that is what decides which artifact ships.

    python src/nwp/evaluate.py --split test
"""

from __future__ import annotations

import argparse
import json
import math
import sys
import time
from pathlib import Path

import numpy as np
import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from nwp.model.transformer import NWPConfig, NWPModel  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
ARTIFACTS = ROOT / "artifacts"


def windows(split: str, block: int, n: int, seed: int = 23) -> np.ndarray:
    data = np.memmap(ARTIFACTS / "data" / f"{split}.bin", dtype=np.uint16, mode="r")
    rng = np.random.default_rng(seed)
    starts = rng.integers(0, len(data) - block - 1, size=n)
    return np.stack([np.asarray(data[s:s + block + 1], dtype=np.int64)
                     for s in starts])


def score(logits: np.ndarray, targets: np.ndarray) -> dict:
    """logits (N, T, V) aligned so logits[:, i] predicts targets[:, i]."""
    N, T, V = logits.shape
    flat = logits.reshape(-1, V)
    tgt = targets.reshape(-1)

    shifted = flat - flat.max(-1, keepdims=True)
    logsumexp = np.log(np.exp(shifted).sum(-1)) + flat.max(-1)
    nll = float((logsumexp - flat[np.arange(len(tgt)), tgt]).sum())

    top5 = np.argpartition(-flat, 5, axis=-1)[:, :5]
    # argpartition doesn't order within the partition, so re-sort the 5.
    rows = np.arange(len(tgt))[:, None]
    top5 = top5[rows, np.argsort(-flat[rows, top5], axis=-1)]

    hit = top5 == tgt[:, None]
    return {
        "nll": nll,
        "n": len(tgt),
        "top1": float(hit[:, 0].mean()),
        "top3": float(hit[:, :3].any(-1).mean()),
        "top5": float(hit.any(-1).mean()),
    }


def merge(parts: list[dict]) -> dict:
    n = sum(p["n"] for p in parts)
    nll = sum(p["nll"] for p in parts)
    return {
        "loss": round(nll / n, 5),
        "perplexity": round(math.exp(nll / n), 3),
        "top1": round(sum(p["top1"] * p["n"] for p in parts) / n, 5),
        "top3": round(sum(p["top3"] * p["n"] for p in parts) / n, 5),
        "top5": round(sum(p["top5"] * p["n"] for p in parts) / n, 5),
        "tokens": n,
    }


def eval_torch(model: NWPModel, batches: np.ndarray, bs: int) -> dict:
    parts = []
    with torch.no_grad():
        for i in range(0, len(batches), bs):
            chunk = torch.from_numpy(batches[i:i + bs])
            x, y = chunk[:, :-1], chunk[:, 1:]
            logits, _ = model(x)
            parts.append(score(logits.float().numpy(), y.numpy()))
    return merge(parts)


def eval_onnx(path: Path, batches: np.ndarray, bs: int) -> dict:
    import onnxruntime as ort

    sess = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
    name = sess.get_inputs()[0].name
    parts = []
    for i in range(0, len(batches), bs):
        chunk = batches[i:i + bs]
        x, y = chunk[:, :-1], chunk[:, 1:]
        logits = sess.run(None, {name: x})[0]
        parts.append(score(logits, y))
    return merge(parts)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ckpt", default=str(ARTIFACTS / "runs" / "nwp-core-base" / "best.pt"))
    ap.add_argument("--split", default="test")
    ap.add_argument("--windows", type=int, default=256)
    ap.add_argument("--batch", type=int, default=8)
    ap.add_argument("--max-top5-drop", type=float, default=1.0,
                    help="max absolute top-5 accuracy loss (pct points) to accept")
    args = ap.parse_args()

    blob = torch.load(args.ckpt, map_location="cpu", weights_only=False)
    cfg = NWPConfig(**blob["config"])
    model = NWPModel(cfg)
    model.load_state_dict(blob["model"])
    model.eval()

    batches = windows(args.split, cfg.block_size, args.windows)
    print(f"[eval] {args.split}: {len(batches)} windows x {cfg.block_size} tokens "
          f"= {len(batches) * cfg.block_size:,} scored positions\n")

    results: dict[str, dict] = {}
    t0 = time.time()
    results["torch-fp32"] = eval_torch(model, batches, args.batch)
    print(f"  torch-fp32   {results['torch-fp32']}  ({time.time()-t0:.0f}s)",
          flush=True)

    export_path = ARTIFACTS / "onnx" / "export.json"
    variants = json.loads(export_path.read_text())["variants"] if export_path.exists() else {}

    for key, info in variants.items():
        p = ARTIFACTS / "onnx" / info["path"]
        if not p.exists():
            continue
        t = time.time()
        try:
            results[key] = eval_onnx(p, batches, args.batch)
            results[key]["bytes"] = info["bytes"]
            print(f"  {key:12} {results[key]}  ({time.time()-t:.0f}s)", flush=True)
        except Exception as exc:  # noqa: BLE001
            print(f"  {key:12} unusable: {type(exc).__name__}", flush=True)

    ref = results["torch-fp32"]
    print("\n  variant        size      ppl     Δppl%    top1     top5    Δtop5pp")
    print("  " + "-" * 68)
    rows = []
    for key, r in results.items():
        d_ppl = 100 * (r["perplexity"] - ref["perplexity"]) / ref["perplexity"]
        d_top5 = 100 * (r["top5"] - ref["top5"])
        size = r.get("bytes", 0) / 1e6
        rows.append((key, size, r, d_ppl, d_top5))
        print(f"  {key:12} {size:6.1f}MB {r['perplexity']:7.2f} "
              f"{d_ppl:+7.2f}% {r['top1']*100:6.2f}% {r['top5']*100:6.2f}% "
              f"{d_top5:+7.2f}pp")

    # Ship the smallest artifact whose top-5 accuracy is within the budget.
    eligible = [
        (key, size) for key, size, r, _, d5 in rows
        if key != "torch-fp32" and abs(d5) <= args.max_top5_drop
    ]
    if eligible:
        best = min(eligible, key=lambda kv: kv[1])
        print(f"\n  -> recommend '{best[0]}' ({best[1]:.1f}MB): "
              f"smallest variant within {args.max_top5_drop}pp of top-5")
    else:
        print("\n  -> no quantised variant meets the top-5 budget; ship fp32")

    out = ARTIFACTS / "onnx" / "eval.json"
    out.write_text(json.dumps({"split": args.split, "results": results}, indent=2))
    print(f"  wrote {out}")


if __name__ == "__main__":
    main()
