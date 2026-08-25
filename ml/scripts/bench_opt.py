"""Isolate the MPS bottleneck: GQA expansion, RMSNorm upcast, torch.compile."""
import sys
import time
from pathlib import Path

import torch
import torch.nn.functional as F

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
import nwp.model.transformer as tf  # noqa: E402

dev = torch.device("mps")
BS, T = 16, 256


def timed(m, bs=BS, n=8, label=""):
    opt = torch.optim.AdamW(m.parameters(), lr=3e-4)
    x = torch.randint(0, m.cfg.vocab_size, (bs, T), device=dev)
    y = torch.randint(0, m.cfg.vocab_size, (bs, T), device=dev)

    def step():
        with torch.autocast(device_type="mps", dtype=torch.bfloat16):
            _, loss = m(x, y)
        loss.backward()
        opt.step()
        opt.zero_grad(set_to_none=True)

    for _ in range(4):
        step()
    torch.mps.synchronize()
    t0 = time.time()
    for _ in range(n):
        step()
    torch.mps.synchronize()
    dt = (time.time() - t0) / n
    print(f"{label:34} {dt*1000:7.1f} ms  {bs*T/dt:9,.0f} tok/s", flush=True)
    return bs * T / dt


print("--- baseline ---")
timed(tf.build_model("base").to(dev), label="base (repeat_interleave + fp32 norm)")

# 1. native GQA in SDPA: never materializes the expanded KV heads
_orig_attn_fwd = tf.Attention.forward


def gqa_forward(self, x, cos, sin):
    B, Tq, _ = x.shape
    q = self.wq(x).view(B, Tq, self.n_head, self.hd).transpose(1, 2)
    k = self.wk(x).view(B, Tq, self.n_kv_head, self.hd).transpose(1, 2)
    v = self.wv(x).view(B, Tq, self.n_kv_head, self.hd).transpose(1, 2)
    q, k = tf.apply_rope(q, cos, sin), tf.apply_rope(k, cos, sin)
    y = F.scaled_dot_product_attention(q, k, v, is_causal=True, enable_gqa=True)
    return self.wo(y.transpose(1, 2).contiguous().view(B, Tq, -1))


print("\n--- variants ---")
try:
    tf.Attention.forward = gqa_forward
    timed(tf.build_model("base").to(dev), label="+ SDPA enable_gqa")
except Exception as e:
    print(f"enable_gqa failed: {e}")
    tf.Attention.forward = _orig_attn_fwd


# 2. RMSNorm without the fp32 round-trip
def fast_rms(self, x):
    return x * torch.rsqrt(x.pow(2).mean(-1, keepdim=True) + self.eps) * self.weight


_orig_rms = tf.RMSNorm.forward
tf.RMSNorm.forward = fast_rms
tps_fast = timed(tf.build_model("base").to(dev), label="+ native-dtype RMSNorm")

# 3. torch.compile on top
try:
    m = tf.build_model("base").to(dev)
    mc = torch.compile(m, backend="aot_eager")
    mc.cfg = m.cfg
    timed(mc, label="+ torch.compile(aot_eager)")
except Exception as e:
    print(f"compile(aot_eager) failed: {type(e).__name__}: {e}")

# 4. larger batch with the fast path
for bs in (32, 48):
    try:
        timed(tf.build_model("base").to(dev), bs=bs, label=f"fast path @ bs={bs}")
    except Exception as e:
        print(f"bs={bs} failed: {type(e).__name__}")

# 5. wider-but-shallower alternative at the same speed budget
print("\n--- shape sweep (fast path) ---")
for name, kw in [
    ("L6 E512", dict(n_layer=6, n_head=8, n_kv_head=4, n_embd=512)),
    ("L8 E384", dict(n_layer=8, n_head=6, n_kv_head=2, n_embd=384)),
    ("L6 E384", dict(n_layer=6, n_head=6, n_kv_head=2, n_embd=384)),
]:
    m = tf.NWPModel(tf.NWPConfig(block_size=256, **kw)).to(dev)
    timed(m, bs=32, label=f"{name} ({m.num_params(True)/1e6:.1f}M non-emb)")
