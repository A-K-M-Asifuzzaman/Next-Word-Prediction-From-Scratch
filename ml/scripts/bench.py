"""Throughput probe: sizes the training run to the wall-clock budget."""
import os
import sys
import time
from pathlib import Path

import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from nwp.model.transformer import build_model  # noqa: E402

dev = torch.device("mps")
CONFIGS = [("tiny", 32), ("base", 16), ("base", 24), ("base", 32), ("large", 12)]

for preset, bs in CONFIGS:
    try:
        m = build_model(preset).to(dev)
        opt = torch.optim.AdamW(m.parameters(), lr=3e-4)
        T = m.cfg.block_size
        x = torch.randint(0, m.cfg.vocab_size, (bs, T), device=dev)
        y = torch.randint(0, m.cfg.vocab_size, (bs, T), device=dev)

        def step():
            with torch.autocast(device_type="mps", dtype=torch.bfloat16):
                _, loss = m(x, y)
            loss.backward()
            opt.step()
            opt.zero_grad(set_to_none=True)

        for _ in range(3):
            step()
        torch.mps.synchronize()
        t0, N = time.time(), 10
        for _ in range(N):
            step()
        torch.mps.synchronize()
        dt = (time.time() - t0) / N
        tps = bs * T / dt
        print(f"{preset:6} bs={bs:3} T={T:4} "
              f"params={m.num_params()/1e6:5.1f}M "
              f"(non-emb {m.num_params(True)/1e6:5.1f}M) "
              f"{dt*1000:7.1f} ms/step {tps:9,.0f} tok/s "
              f"-> 1h={tps*3600/1e6:6.0f}M tok", flush=True)
        del m, opt, x, y
        torch.mps.empty_cache()
    except Exception as exc:  # noqa: BLE001
        print(f"{preset:6} bs={bs:3} FAILED: {type(exc).__name__}: {exc}", flush=True)
