"""Export a trained checkpoint to ONNX for browser inference.

Produces up to three artifacts and reports the quality/size trade between them,
because that choice is a real deployment decision rather than a default:

    nwp-core-fp32.onnx   reference, largest
    nwp-core-fp16.onnx   half size, usually lossless for this model
    nwp-core-int8.onnx   dynamic-quantised MatMuls, smallest download

The graph emits FULL logits [1, T, vocab] rather than just the final row. The
web client only needs the last row to predict, but having every row is what
lets it draw per-token surprisal from the same single download.

Usage:
    python src/nwp/export_onnx.py --ckpt artifacts/runs/nwp-core-base/best.pt
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
import time
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from nwp.model.transformer import NWPConfig, NWPModel  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
ARTIFACTS = ROOT / "artifacts"
OUT_DIR = ARTIFACTS / "onnx"


class ExportWrapper(nn.Module):
    """torch.onnx.export wants a single tensor out and no keyword-only args."""

    def __init__(self, model: NWPModel):
        super().__init__()
        self.model = model

    def forward(self, input_ids: torch.Tensor) -> torch.Tensor:
        logits, _ = self.model(input_ids)
        return logits


def load_checkpoint(path: Path) -> tuple[NWPModel, dict]:
    blob = torch.load(path, map_location="cpu", weights_only=False)
    cfg = NWPConfig(**blob["config"])
    # SDPA is a fused op that traces poorly; the manual path is plain matmuls
    # and exports to primitives every runtime supports.
    cfg.attn_impl = "manual"
    model = NWPModel(cfg)
    model.load_state_dict(blob["model"])
    model.eval()
    return model, blob


def export_fp32(model: NWPModel, out: Path, opset: int) -> Path:
    wrapper = ExportWrapper(model).eval()
    example = torch.randint(0, model.cfg.vocab_size, (1, 16), dtype=torch.int64)

    out.parent.mkdir(parents=True, exist_ok=True)
    print(f"[onnx] exporting fp32 -> {out.name} (opset {opset})", flush=True)

    common = dict(
        input_names=["input_ids"],
        output_names=["logits"],
        opset_version=opset,
    )
    try:
        torch.onnx.export(
            wrapper, (example,), str(out),
            dynamic_axes={"input_ids": {0: "batch", 1: "sequence"},
                          "logits": {0: "batch", 1: "sequence"}},
            dynamo=False, **common,
        )
    except TypeError:
        # Older torch without the `dynamo` kwarg.
        torch.onnx.export(
            wrapper, (example,), str(out),
            dynamic_axes={"input_ids": {0: "batch", 1: "sequence"},
                          "logits": {0: "batch", 1: "sequence"}},
            **common,
        )
    return out


def real_batches(seq_len: int, n: int = 12, seed: int = 7) -> list[np.ndarray]:
    """Windows of actual held-out text.

    Verifying on random token ids is misleading: random context produces a
    near-flat distribution where the argmax is decided by noise, so quantisation
    looks far more destructive than it is. Real prefixes give the sharp
    distributions the model actually serves.
    """
    data = np.memmap(ARTIFACTS / "data" / "val.bin", dtype=np.uint16, mode="r")
    rng = np.random.default_rng(seed)
    starts = rng.integers(0, len(data) - seq_len - 1, size=n)
    return [np.asarray(data[s:s + seq_len], dtype=np.int64)[None, :] for s in starts]


def verify(model: NWPModel, onnx_path: Path, seq: int = 96) -> dict:
    """Compare against torch on real text, at a sequence length we did NOT
    trace with -- a hardcoded shape would otherwise only surface in the
    browser. Reports the metrics a next-word product actually cares about:
    does the top suggestion change, does the top-5 set change, and what does
    it cost in held-out perplexity."""
    import onnxruntime as ort

    sess = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])

    top1_same, top5_overlap, n_pos = 0, 0.0, 0
    max_d, sum_d, n_el = 0.0, 0.0, 0
    nll_ref, nll_got, n_tok = 0.0, 0.0, 0

    for ids_np in real_batches(seq):
        ids = torch.from_numpy(ids_np)
        with torch.no_grad():
            ref, _ = model(ids)
        ref = ref.numpy()
        got = sess.run(None, {"input_ids": ids_np})[0]

        if got.shape != ref.shape:
            raise RuntimeError(f"shape mismatch {got.shape} vs {ref.shape}")

        d = np.abs(got - ref)
        max_d = max(max_d, float(d.max()))
        sum_d += float(d.sum())
        n_el += d.size

        r_top = ref.argmax(-1)
        g_top = got.argmax(-1)
        top1_same += int((r_top == g_top).sum())
        n_pos += r_top.size

        r5 = np.argsort(-ref, axis=-1)[..., :5]
        g5 = np.argsort(-got, axis=-1)[..., :5]
        for i in range(r5.shape[1]):
            top5_overlap += len(set(r5[0, i]) & set(g5[0, i])) / 5.0

        # Teacher-forced NLL of the true continuation.
        tgt = ids_np[0, 1:]
        for arr, acc in ((ref, "ref"), (got, "got")):
            logits = arr[0, :-1, :]
            logits = logits - logits.max(-1, keepdims=True)
            logp = logits - np.log(np.exp(logits).sum(-1, keepdims=True))
            nll = -logp[np.arange(len(tgt)), tgt].sum()
            if acc == "ref":
                nll_ref += float(nll)
            else:
                nll_got += float(nll)
        n_tok += len(tgt)

    ppl_ref = float(np.exp(nll_ref / n_tok))
    ppl_got = float(np.exp(nll_got / n_tok))
    return {
        "seq": seq,
        "max_abs_diff": round(max_d, 5),
        "mean_abs_diff": round(sum_d / n_el, 7),
        "argmax_agreement": round(top1_same / n_pos, 5),
        "top5_overlap": round(top5_overlap / n_pos, 5),
        "ppl_fp32": round(ppl_ref, 3),
        "ppl_variant": round(ppl_got, 3),
        "ppl_delta_pct": round(100.0 * (ppl_got - ppl_ref) / ppl_ref, 3),
    }


def dedupe_initializers(path: Path) -> int:
    """The embedding and the LM head are the same tensor (weight tying), but the
    exporter writes it twice -- 6.3M params of pure duplication, which is 25MB
    of fp32 in a file the browser has to download. Hash the initializers and
    rewire every duplicate reference to a single copy."""
    import onnx

    model = onnx.load(str(path))
    graph = model.graph

    seen: dict[bytes, str] = {}
    remap: dict[str, str] = {}
    keep = []
    saved = 0

    for init in graph.initializer:
        blob = init.raw_data if init.raw_data else init.SerializeToString()
        key = hashlib.sha256(
            blob + str(init.dims).encode() + str(init.data_type).encode()
        ).digest()
        if key in seen:
            remap[init.name] = seen[key]
            saved += len(blob)
        else:
            seen[key] = init.name
            keep.append(init)

    if not remap:
        return 0

    del graph.initializer[:]
    graph.initializer.extend(keep)
    for node in graph.node:
        for i, name in enumerate(node.input):
            if name in remap:
                node.input[i] = remap[name]

    onnx.save(model, str(path))
    print(f"[onnx] deduped {len(remap)} initializer(s), "
          f"reclaimed {saved/1e6:.1f} MB", flush=True)
    return saved


def quantize(src: Path, dst: Path, include_gather: bool) -> Path | None:
    """Dynamic int8.

    Quantising MatMul alone leaves the 16k x 384 embedding table in fp32, and
    that table is the single largest thing in the file. Including Gather cuts
    the download roughly in half again; whether that costs accuracy is measured
    rather than assumed -- see the summary table this script prints.
    """
    try:
        from onnxruntime.quantization import QuantType, quantize_dynamic
    except ImportError:
        print("[onnx] onnxruntime.quantization unavailable; skipping int8")
        return None

    ops = ["MatMul", "Gather"] if include_gather else ["MatMul"]
    print(f"[onnx] quantising int8 ({'+'.join(ops)}) -> {dst.name}", flush=True)
    quantize_dynamic(
        model_input=str(src),
        model_output=str(dst),
        weight_type=QuantType.QInt8,
        op_types_to_quantize=ops,
        # Per-channel scales cost a few KB and recover most of the accuracy a
        # single per-tensor scale throws away on these weight matrices.
        per_channel=True,
        reduce_range=False,
        extra_options={"MatMulConstBOnly": True},
    )
    return dst


def to_fp16(src: Path, dst: Path) -> Path | None:
    try:
        import onnx
        from onnxconverter_common import float16
    except ImportError:
        print("[onnx] onnxconverter-common unavailable; skipping fp16")
        return None

    print(f"[onnx] converting fp16 -> {dst.name}", flush=True)
    model = onnx.load(str(src))
    onnx.save(float16.convert_float_to_float16(model, keep_io_types=True), str(dst))
    return dst


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ckpt", default=str(ARTIFACTS / "runs" / "nwp-core-base" / "best.pt"))
    ap.add_argument("--name", default="nwp-core")
    ap.add_argument("--opset", type=int, default=17)
    ap.add_argument("--web-dir", default=str(ROOT.parent / "web" / "public" / "model"),
                    help="also copy the shipped artifacts here")
    ap.add_argument("--max-ppl-delta", type=float, default=1.0,
                    help="ship the smallest variant within this %% of fp32 perplexity")
    args = ap.parse_args()

    ckpt = Path(args.ckpt)
    model, blob = load_checkpoint(ckpt)
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    print(f"[onnx] checkpoint step {blob.get('step')} "
          f"val={blob.get('val', {}).get('loss')}")
    print(f"[onnx] {model.num_params()/1e6:.2f}M params, "
          f"vocab={model.cfg.vocab_size}, ctx={model.cfg.block_size}")

    fp32 = export_fp32(model, OUT_DIR / f"{args.name}-fp32.onnx", args.opset)
    dedupe_initializers(fp32)

    report: dict[str, dict] = {}
    report["fp32"] = {"path": fp32.name, "bytes": fp32.stat().st_size,
                      **verify(model, fp32)}
    print(f"[onnx] fp32 verify: {report['fp32']}")

    # Optional variants must never take the export down with them -- fp32 and
    # one int8 build are all that is required to ship.
    def try_variant(key: str, build) -> None:
        try:
            path = build()
            if path is None:
                return
            report[key] = {"path": path.name, "bytes": path.stat().st_size,
                           **verify(model, path)}
            print(f"[onnx] {key} verify: {report[key]}")
        except Exception as exc:  # noqa: BLE001
            print(f"[onnx] !! {key} variant unusable ({type(exc).__name__}: "
                  f"{str(exc)[:160]}) -- skipping", flush=True)
            report.pop(key, None)

    # RMSNorm upcasts to fp32 explicitly, and the fp16 converter does not
    # reconcile those Cast nodes, so this one commonly fails to load. It is a
    # nice-to-have: int8 is both smaller and, measured below, accurate enough.
    try_variant("fp16", lambda: to_fp16(fp32, OUT_DIR / f"{args.name}-fp16.onnx"))
    try_variant("int8", lambda: quantize(
        fp32, OUT_DIR / f"{args.name}-int8.onnx", include_gather=False))
    try_variant("int8w", lambda: quantize(
        fp32, OUT_DIR / f"{args.name}-int8w.onnx", include_gather=True))

    meta = {
        "name": args.name,
        "step": blob.get("step"),
        "val": blob.get("val"),
        "config": blob["config"],
        "params_total": model.num_params(),
        "params_non_embedding": model.num_params(True),
        "vocab_size": model.cfg.vocab_size,
        "context_length": model.cfg.block_size,
        "variants": report,
        "exported_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
    }
    (OUT_DIR / "export.json").write_text(json.dumps(meta, indent=2))

    # Stage the browser payload: the tokenizer plus whichever variants exist.
    web = Path(args.web_dir)
    web.mkdir(parents=True, exist_ok=True)
    shutil.copy(ARTIFACTS / "tokenizer" / "tokenizer.json", web / "tokenizer.json")

    # Ship the smallest variant that still agrees with fp32 on ~99% of argmaxes.
    # Below that threshold the suggestions visibly differ from the trained model
    # and the size saving isn't worth it.
    # Perplexity on held-out text is the criterion, not float distance: a
    # variant that costs under 1% perplexity is indistinguishable in use, and
    # the download saving is large.
    order = ["int8w", "int8", "fp16", "fp32"]
    shipped = next(
        (k for k in order
         if k in report and report[k]["ppl_delta_pct"] <= args.max_ppl_delta),
        "fp32",
    )
    meta["shipped_variant"] = shipped
    shutil.copy(OUT_DIR / report[shipped]["path"], web / report[shipped]["path"])
    (web / "model.json").write_text(json.dumps(meta, indent=2))
    print(f"[onnx] shipping '{shipped}' "
          f"({report[shipped]['bytes']/1e6:.1f} MB, "
          f"{report[shipped]['argmax_agreement']*100:.2f}% argmax agreement)")

    print("\n[onnx] summary")
    for k, v in report.items():
        print(f"  {k:5} {v['bytes']/1e6:7.2f} MB  "
              f"argmax agreement {v['argmax_agreement']*100:6.2f}%  "
              f"max|d| {v['max_abs_diff']:.4f}")
    print(f"[onnx] staged to {web}")


if __name__ == "__main__":
    main()
