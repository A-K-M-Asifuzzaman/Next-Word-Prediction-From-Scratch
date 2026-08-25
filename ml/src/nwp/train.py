"""Training loop for NWP-Core.

Run:
    python src/nwp/train.py --config config/base.yaml
    python src/nwp/train.py --config config/base.yaml --resume

Everything the web dashboard shows about training comes from the JSONL metric
stream this writes to artifacts/runs/<run>/metrics.jsonl - the charts in the
admin panel are real telemetry, not mock data.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import signal
import sys
import time
from contextlib import nullcontext
from dataclasses import asdict
from pathlib import Path

import numpy as np
import torch
import yaml

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from nwp.data.dataset import TokenStream, load_meta          # noqa: E402
from nwp.model.transformer import NWPConfig, NWPModel, PRESETS  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
ARTIFACTS = ROOT / "artifacts"


# ---------------------------------------------------------------------------

def pick_device(requested: str) -> torch.device:
    if requested != "auto":
        return torch.device(requested)
    if torch.backends.mps.is_available():
        return torch.device("mps")
    if torch.cuda.is_available():
        return torch.device("cuda")
    return torch.device("cpu")


def lr_at(step: int, cfg: dict) -> float:
    """Linear warmup -> cosine decay to min_lr."""
    warmup, total = cfg["warmup_steps"], cfg["max_steps"]
    lr, min_lr = cfg["lr"], cfg["min_lr"]
    if step < warmup:
        return lr * (step + 1) / (warmup + 1)
    if step >= total:
        return min_lr
    ratio = (step - warmup) / max(1, total - warmup)
    return min_lr + 0.5 * (1.0 + math.cos(math.pi * ratio)) * (lr - min_lr)


def build_optimizer(model: NWPModel, weight_decay: float, lr: float,
                    betas: tuple[float, float], device: torch.device):
    """Decay matmul weights only. Norms and biases are 1-D and shouldn't be
    pulled toward zero -- doing so measurably hurts small models."""
    decay, no_decay = [], []
    for name, p in model.named_parameters():
        if not p.requires_grad:
            continue
        (decay if p.dim() >= 2 else no_decay).append(p)
    groups = [
        {"params": decay, "weight_decay": weight_decay},
        {"params": no_decay, "weight_decay": 0.0},
    ]
    extra = {}
    if device.type == "cuda":
        extra["fused"] = True
    opt = torch.optim.AdamW(groups, lr=lr, betas=betas, eps=1e-8, **extra)
    print(f"[opt] decayed tensors={len(decay)} "
          f"({sum(p.numel() for p in decay):,} params), "
          f"undecayed={len(no_decay)} "
          f"({sum(p.numel() for p in no_decay):,} params)")
    return opt


@torch.no_grad()
def evaluate(model: NWPModel, stream: TokenStream, device: torch.device,
             batch_size: int, batches: int, autocast_ctx) -> dict:
    """Held-out loss plus the metrics that actually matter for an autocomplete
    product: how often is the true next token in our top-1/3/5 suggestions."""
    model.eval()
    losses, hits1, hits3, hits5, total = [], 0, 0, 0, 0
    for i, (x, y) in enumerate(stream.sequential_batches(batch_size, device,
                                                         max_batches=batches)):
        if i >= batches:
            break
        with autocast_ctx:
            logits, loss = model(x, y)
        losses.append(loss.item())
        top5 = logits.float().topk(5, dim=-1).indices        # (B, T, 5)
        tgt = y.unsqueeze(-1)
        eq = (top5 == tgt)
        hits1 += eq[..., :1].any(-1).sum().item()
        hits3 += eq[..., :3].any(-1).sum().item()
        hits5 += eq.any(-1).sum().item()
        total += y.numel()
    model.train()
    mean_loss = float(np.mean(losses)) if losses else float("nan")
    return {
        "loss": mean_loss,
        "perplexity": math.exp(min(mean_loss, 20)),
        "top1": hits1 / max(total, 1),
        "top3": hits3 / max(total, 1),
        "top5": hits5 / max(total, 1),
        "tokens_scored": total,
    }


# ---------------------------------------------------------------------------

def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default=str(ROOT / "config" / "base.yaml"))
    ap.add_argument("--resume", action="store_true")
    ap.add_argument("--max-hours", type=float, default=None,
                    help="stop cleanly after this much wall time")
    args = ap.parse_args()

    cfg = yaml.safe_load(Path(args.config).read_text())
    run_dir = ARTIFACTS / "runs" / cfg["run_name"]
    run_dir.mkdir(parents=True, exist_ok=True)
    metrics_path = run_dir / "metrics.jsonl"

    torch.manual_seed(cfg["seed"])
    np.random.seed(cfg["seed"])
    rng = np.random.default_rng(cfg["seed"])

    device = pick_device(cfg.get("device", "auto"))
    data_dir = ARTIFACTS / "data"
    meta = load_meta(data_dir)
    print(f"[init] device={device}  corpus={meta['tokens']['train']:,} train tokens "
          f"vocab={meta['vocab_size']:,}")

    model_cfg = NWPConfig(**{**PRESETS[cfg["preset"]],
                             **cfg.get("model", {}),
                             "vocab_size": meta["vocab_size"]})
    model = NWPModel(model_cfg).to(device)
    print(f"[init] {cfg['preset']}: {model.num_params()/1e6:.2f}M params "
          f"({model.num_params(True)/1e6:.2f}M non-embedding), "
          f"ctx={model_cfg.block_size}, ffn_hidden={model_cfg.ffn_hidden}")

    train_stream = TokenStream(data_dir, "train", model_cfg.block_size)
    val_stream = TokenStream(data_dir, "val", model_cfg.block_size)

    opt = build_optimizer(model, cfg["weight_decay"], cfg["lr"],
                          tuple(cfg["betas"]), device)

    # bf16 autocast: ~1.6x faster on MPS with no loss-scaling needed.
    use_amp = cfg.get("amp", True) and device.type in ("mps", "cuda")
    autocast_ctx = (torch.autocast(device_type=device.type, dtype=torch.bfloat16)
                    if use_amp else nullcontext())
    print(f"[init] autocast={'bf16' if use_amp else 'off'}")

    start_step, best_val = 0, float("inf")
    ckpt_last, ckpt_best = run_dir / "last.pt", run_dir / "best.pt"
    if args.resume and ckpt_last.exists():
        blob = torch.load(ckpt_last, map_location=device, weights_only=False)
        model.load_state_dict(blob["model"])
        opt.load_state_dict(blob["optimizer"])
        start_step, best_val = blob["step"] + 1, blob.get("best_val", float("inf"))
        print(f"[init] resumed from step {start_step:,} (best val {best_val:.4f})")

    grad_accum = cfg["grad_accum"]
    batch_size = cfg["batch_size"]
    tokens_per_step = batch_size * grad_accum * model_cfg.block_size
    print(f"[init] batch={batch_size} x accum={grad_accum} x ctx={model_cfg.block_size} "
          f"= {tokens_per_step:,} tokens/step; "
          f"{cfg['max_steps']:,} steps = {tokens_per_step * cfg['max_steps']/1e9:.2f}B tokens")

    stop = {"flag": False}

    def _handle(signum, frame):                    # graceful Ctrl-C / SIGTERM
        print("\n[signal] finishing current step then checkpointing ...", flush=True)
        stop["flag"] = True

    signal.signal(signal.SIGINT, _handle)
    signal.signal(signal.SIGTERM, _handle)

    def write_metric(rec: dict) -> None:
        with open(metrics_path, "a") as fh:
            fh.write(json.dumps(rec) + "\n")

    def save(path: Path, step: int, val: dict | None) -> None:
        torch.save({
            "model": model.state_dict(),
            "optimizer": opt.state_dict(),
            "step": step,
            "best_val": best_val,
            "config": asdict(model_cfg),
            "train_config": cfg,
            "val": val,
            "vocab_size": meta["vocab_size"],
        }, path)

    t_start = time.time()
    t_last = t_start
    running_loss = None
    print(f"[train] starting at step {start_step:,}\n", flush=True)

    for step in range(start_step, cfg["max_steps"]):
        lr = lr_at(step, cfg)
        for g in opt.param_groups:
            g["lr"] = lr

        opt.zero_grad(set_to_none=True)
        loss_acc = 0.0
        for _ in range(grad_accum):
            x, y = train_stream.batch(batch_size, device, rng)
            with autocast_ctx:
                _, loss = model(x, y)
            (loss / grad_accum).backward()
            loss_acc += loss.item() / grad_accum

        grad_norm = torch.nn.utils.clip_grad_norm_(model.parameters(),
                                                   cfg["grad_clip"])
        opt.step()

        running_loss = loss_acc if running_loss is None else \
            0.9 * running_loss + 0.1 * loss_acc

        if step % cfg["log_every"] == 0:
            if device.type == "mps":
                torch.mps.synchronize()
            now = time.time()
            dt = (now - t_last) / max(1, cfg["log_every"] if step > start_step else 1)
            t_last = now
            tok_s = tokens_per_step / dt if dt > 0 else 0
            elapsed = now - t_start
            eta = (cfg["max_steps"] - step) * dt
            rec = {
                "type": "train", "step": step, "loss": round(loss_acc, 4),
                "ema_loss": round(running_loss, 4),
                "perplexity": round(math.exp(min(running_loss, 20)), 2),
                "lr": lr, "grad_norm": round(float(grad_norm), 3),
                "tokens": (step + 1) * tokens_per_step,
                "tokens_per_sec": round(tok_s), "elapsed_s": round(elapsed),
                "wall": time.strftime("%H:%M:%S"),
            }
            write_metric(rec)
            print(f"[{step:>6}/{cfg['max_steps']}] loss {loss_acc:.4f} "
                  f"ema {running_loss:.4f} ppl {rec['perplexity']:>7.2f} "
                  f"lr {lr:.2e} gn {rec['grad_norm']:.2f} "
                  f"{tok_s/1000:.1f}k tok/s  eta {eta/3600:.2f}h", flush=True)

        if step > 0 and step % cfg["eval_every"] == 0:
            val = evaluate(model, val_stream, device, cfg["eval_batch_size"],
                           cfg["eval_batches"], autocast_ctx)
            val.update({"type": "eval", "step": step,
                        "tokens": (step + 1) * tokens_per_step,
                        "elapsed_s": round(time.time() - t_start)})
            write_metric(val)
            flag = ""
            if val["loss"] < best_val:
                best_val = val["loss"]
                save(ckpt_best, step, val)
                flag = "  <- best"
            save(ckpt_last, step, val)
            print(f"  [eval] loss {val['loss']:.4f}  ppl {val['perplexity']:.2f}  "
                  f"top1 {val['top1']*100:.1f}%  top3 {val['top3']*100:.1f}%  "
                  f"top5 {val['top5']*100:.1f}%{flag}", flush=True)

        budget = args.max_hours or cfg.get("max_hours")
        if stop["flag"] or (budget and (time.time() - t_start) / 3600 >= budget):
            print(f"[train] stopping at step {step:,}", flush=True)
            val = evaluate(model, val_stream, device, cfg["eval_batch_size"],
                           cfg["eval_batches"], autocast_ctx)
            if val["loss"] < best_val:
                best_val = val["loss"]
                save(ckpt_best, step, val)
            save(ckpt_last, step, val)
            break
    else:
        val = evaluate(model, val_stream, device, cfg["eval_batch_size"],
                       cfg["eval_batches"], autocast_ctx)
        val.update({"type": "eval", "step": cfg["max_steps"], "final": True})
        write_metric(val)
        if val["loss"] < best_val:
            best_val = val["loss"]
            save(ckpt_best, cfg["max_steps"] - 1, val)
        save(ckpt_last, cfg["max_steps"] - 1, val)
        print(f"[done] final val loss {val['loss']:.4f} ppl {val['perplexity']:.2f}")

    print(f"[done] best val loss {best_val:.4f} (ppl {math.exp(min(best_val,20)):.2f}) "
          f"in {(time.time()-t_start)/3600:.2f}h -> {ckpt_best}", flush=True)


if __name__ == "__main__":
    os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")
    main()
