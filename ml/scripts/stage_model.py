"""Stage one exported variant into the web app's public directory.

Kept separate from export_onnx.py on purpose. Export produces candidates;
evaluate.py measures them on held-out text; this makes the ship decision from
that measurement. The criterion is top-5 accuracy, not perplexity:

    variant   size      ppl     Δppl     top-5    Δtop-5
    fp32     103.5MB   32.10        -   58.80%         -
    int8w     26.6MB   33.10   +3.13%   58.53%   -0.27pp

A 3% perplexity rise sounds alarming and a 0.27-point top-5 drop does not, but
they describe the same model. Top-5 is what a person using an autocomplete
experiences -- was my word in the list -- so that is the number the gate uses.

    python ml/scripts/stage_model.py            # auto-pick
    python ml/scripts/stage_model.py --variant fp32
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / "artifacts"
ONNX_DIR = ARTIFACTS / "onnx"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--web-dir", default=str(ROOT.parent / "web" / "public" / "model"))
    ap.add_argument("--variant", default=None,
                    help="force a variant instead of picking by measurement")
    ap.add_argument("--max-top5-drop", type=float, default=1.0,
                    help="max top-5 accuracy loss in percentage points")
    args = ap.parse_args()

    export = json.loads((ONNX_DIR / "export.json").read_text())
    eval_path = ONNX_DIR / "eval.json"
    if not eval_path.exists():
        sys.exit("run `python src/nwp/evaluate.py` first -- staging is "
                 "decided by measurement, not by default")
    results = json.loads(eval_path.read_text())["results"]

    ref = results.get("fp32") or results["torch-fp32"]

    if args.variant:
        chosen = args.variant
    else:
        eligible = [
            (k, r.get("bytes", 1 << 62))
            for k, r in results.items()
            if k not in ("torch-fp32",)
            and abs(100 * (r["top5"] - ref["top5"])) <= args.max_top5_drop
            and k in export["variants"]
        ]
        if not eligible:
            sys.exit("no variant met the top-5 budget")
        chosen = min(eligible, key=lambda kv: kv[1])[0]

    if chosen not in export["variants"]:
        sys.exit(f"variant '{chosen}' was not exported")

    info = export["variants"][chosen]
    res = results[chosen]
    web = Path(args.web_dir)
    web.mkdir(parents=True, exist_ok=True)

    # Clear stale artifacts so the deployment never carries an unused 103MB file.
    for old in web.glob("*.onnx"):
        old.unlink()

    shutil.copy(ONNX_DIR / info["path"], web / info["path"])
    shutil.copy(ARTIFACTS / "tokenizer" / "tokenizer.json", web / "tokenizer.json")

    manifest = {
        **{k: v for k, v in export.items() if k != "variants"},
        "variants": {chosen: info},
        "shipped_variant": chosen,
        "measured": {
            "split": "test",
            "perplexity": res["perplexity"],
            "top1": res["top1"],
            "top3": res["top3"],
            "top5": res["top5"],
            "top5_delta_pp": round(100 * (res["top5"] - ref["top5"]), 3),
            "tokens_scored": res["tokens"],
        },
    }
    (web / "model.json").write_text(json.dumps(manifest, indent=2))

    print(f"[stage] {chosen}: {info['bytes']/1e6:.1f}MB · "
          f"ppl {res['perplexity']} · top-5 {res['top5']*100:.2f}% "
          f"({manifest['measured']['top5_delta_pp']:+.2f}pp vs fp32)")
    print(f"[stage] -> {web}")


if __name__ == "__main__":
    main()
