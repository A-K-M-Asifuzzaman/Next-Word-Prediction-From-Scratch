"""Publish a training run and its exported model to the NWP-Core backend.

The admin panel's training charts are not mock data -- they are this run's
metrics.jsonl loaded into Postgres. This uploads it over PostgREST while
authenticated as an admin, so the same row-level security that guards the app
guards the ingest: there is no service-role key anywhere in this repo.

    python ml/scripts/publish_run.py --email you@example.com --password ...

Train metrics are logged every 20 steps (~800 rows over a 16k-step run), more
resolution than a 720px chart can render, so the stream is downsampled on the
way in. Every eval row is kept -- there are only ~32 and they are the ones that
matter.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / "artifacts"

SUPABASE_URL = os.environ.get(
    "NWP_SUPABASE_URL", "https://obuhrzoycjdonjyvrork.supabase.co")
ANON_KEY = os.environ.get(
    "NWP_SUPABASE_ANON_KEY", "sb_publishable_VyWJhiePgh6PhGy4JbJV9g_CFVpQgB2")


def api(path: str, method: str = "GET", body=None, token: str | None = None,
        prefer: str | None = None):
    url = f"{SUPABASE_URL}{path}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("apikey", ANON_KEY)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    if prefer:
        req.add_header("Prefer", prefer)
    try:
        with urllib.request.urlopen(req) as r:
            raw = r.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        sys.exit(f"{method} {path} -> {e.code}: {e.read().decode()[:400]}")


def sign_in(email: str, password: str) -> str:
    res = api("/auth/v1/token?grant_type=password", "POST",
              {"email": email, "password": password})
    return res["access_token"]


def downsample(rows: list[dict], target: int) -> list[dict]:
    if len(rows) <= target:
        return rows
    stride = len(rows) // target + 1
    out = rows[::stride]
    if out[-1] is not rows[-1]:
        out.append(rows[-1])
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", default="nwp-core-base")
    ap.add_argument("--version", default="v1")
    ap.add_argument("--max-train-points", type=int, default=220)
    ap.add_argument("--status", default="complete",
                    choices=["running", "complete", "failed"])
    ap.add_argument("--email", default=os.environ.get("NWP_ADMIN_EMAIL"))
    ap.add_argument("--password", default=os.environ.get("NWP_ADMIN_PASSWORD"))
    args = ap.parse_args()

    if not args.email or not args.password:
        sys.exit("need --email/--password (or NWP_ADMIN_EMAIL / NWP_ADMIN_PASSWORD)")

    run_dir = ARTIFACTS / "runs" / args.run
    metrics_path = run_dir / "metrics.jsonl"
    if not metrics_path.exists():
        sys.exit(f"no metrics at {metrics_path}")

    export = json.loads((ARTIFACTS / "onnx" / "export.json").read_text())
    data_meta = json.loads((ARTIFACTS / "data" / "meta.json").read_text())

    rows = [json.loads(l) for l in metrics_path.read_text().splitlines() if l.strip()]
    train = [r for r in rows if r.get("type") == "train"]
    evals = [r for r in rows if r.get("type") == "eval"]
    if not evals:
        sys.exit("no eval rows yet -- let training reach its first eval step")

    best = min(evals, key=lambda r: r["loss"])
    last = train[-1] if train else {}

    cfg = dict(export["config"])
    cfg.update({"lr": 8.0e-4, "batch_size": 32, "grad_accum": 2,
                "weight_decay": 0.1, "warmup_steps": 500, "max_steps": 16000})

    variant = export.get("shipped_variant", "int8w")
    vinfo = export["variants"][variant]

    token = sign_in(args.email, args.password)
    print(f"[publish] authenticated as {args.email}")

    # Replace rather than append: republishing a run mid-training should not
    # leave two overlapping copies of the same curve.
    api(f"/rest/v1/training_runs?run_name=eq.{args.run}", "DELETE", token=token)

    run_row = api("/rest/v1/training_runs", "POST", {
        "run_name": args.run,
        "config": cfg,
        "corpus": data_meta["tokens"],
        "device": "apple m3 pro · mps",
        "status": args.status,
        "total_steps": last.get("step", 0),
        "tokens_seen": last.get("tokens", 0),
        "best_val_loss": round(best["loss"], 5),
        "best_perplexity": round(best["perplexity"], 3),
    }, token=token, prefer="return=representation")
    run_id = run_row[0]["id"]
    print(f"[publish] run {args.run} -> {run_id}")

    kept = downsample(train, args.max_train_points)

    def row(r: dict, kind: str) -> dict:
        # PostgREST bulk insert requires every object in the array to carry the
        # same key set, so train and eval rows are padded to one shape.
        return {
            "run_id": run_id,
            "kind": kind,
            "step": r["step"],
            "tokens": r.get("tokens", 0),
            "loss": r.get("loss"),
            "ema_loss": r.get("ema_loss"),
            "perplexity": min(r.get("perplexity", 0), 1e9),
            "lr": r.get("lr"),
            "grad_norm": r.get("grad_norm"),
            "tokens_per_sec": r.get("tokens_per_sec"),
            "top1": r.get("top1"),
            "top3": r.get("top3"),
            "top5": r.get("top5"),
            "elapsed_s": r.get("elapsed_s", 0),
        }

    metrics = [row(r, "train") for r in kept] + [row(r, "eval") for r in evals]

    for i in range(0, len(metrics), 250):
        api("/rest/v1/training_metrics", "POST", metrics[i:i + 250], token=token)
    print(f"[publish] {len(metrics)} metric rows "
          f"({len(kept)} train downsampled from {len(train)}, {len(evals)} eval)")

    notes = (
        f"Dynamic int8 with per-channel scales. Costs {vinfo['ppl_delta_pct']}% "
        f"perplexity against fp32 while cutting the download from "
        f"{export['variants']['fp32']['bytes'] / 1e6:.0f}MB to "
        f"{vinfo['bytes'] / 1e6:.1f}MB. Top-5 agreement with fp32: "
        f"{vinfo['top5_overlap'] * 100:.1f}%."
    )

    api(f"/rest/v1/models?name=eq.nwp-core&version=eq.{args.version}",
        "DELETE", token=token)
    model_row = api("/rest/v1/models", "POST", {
        "name": "nwp-core",
        "version": args.version,
        "quantization": variant,
        "architecture": export["config"],
        "params_total": export["params_total"],
        "params_non_embedding": export["params_non_embedding"],
        "vocab_size": export["vocab_size"],
        "context_length": export["context_length"],
        "train_tokens": last.get("tokens", 0),
        "val_loss": round(best["loss"], 5),
        "perplexity": round(best["perplexity"], 3),
        "top1": round(best["top1"], 5),
        "top3": round(best["top3"], 5),
        "top5": round(best["top5"], 5),
        "artifact_path": f"/model/{vinfo['path']}",
        "size_bytes": vinfo["bytes"],
        "status": "candidate",
        "notes": notes,
    }, token=token, prefer="return=representation")

    # Promote through the RPC so the incumbent is demoted in the same
    # transaction and the change lands in the audit log.
    api("/rest/v1/rpc/admin_activate_model", "POST",
        {"target": model_row[0]["id"]}, token=token)
    print(f"[publish] model nwp-core:{args.version} ({variant}, "
          f"{vinfo['bytes'] / 1e6:.1f}MB) is now active")


if __name__ == "__main__":
    main()
