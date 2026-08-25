"""NWP-Core: a decoder-only transformer trained from scratch for next-word
prediction.

Architecture is deliberately modern-small rather than a GPT-2 reimplementation:

    RMSNorm            cheaper than LayerNorm, no bias term to learn
    RoPE               relative positions, and lets us extrapolate past the
                       training context at inference without a learned table
    SwiGLU FFN         better quality per parameter than GELU-MLP
    GQA                fewer KV heads -> smaller KV cache, which matters a lot
                       when this runs in a browser via WASM
    tied embeddings    input embedding IS the output head; saves 8.4M params on
                       a 16k vocab, and helps a small model considerably

The whole module is ONNX-exportable: set `config.attn_impl = "manual"` to swap
scaled_dot_product_attention for explicit matmuls before tracing.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field, asdict

import torch
import torch.nn as nn
import torch.nn.functional as F


@dataclass
class NWPConfig:
    vocab_size: int = 16384
    n_layer: int = 8
    n_head: int = 8
    n_kv_head: int = 4          # grouped-query attention
    n_embd: int = 512
    block_size: int = 256
    ffn_mult: float = 2.75      # hidden = round_to(n_embd * mult, 64)
    dropout: float = 0.0
    rope_theta: float = 10_000.0
    tie_embeddings: bool = True
    attn_impl: str = "sdpa"     # "sdpa" for training, "manual" for ONNX export

    @property
    def head_dim(self) -> int:
        return self.n_embd // self.n_head

    @property
    def ffn_hidden(self) -> int:
        h = int(self.n_embd * self.ffn_mult)
        return ((h + 63) // 64) * 64

    def to_dict(self) -> dict:
        return asdict(self)


# ---------------------------------------------------------------------------
# building blocks
# ---------------------------------------------------------------------------

class RMSNorm(nn.Module):
    def __init__(self, dim: int, eps: float = 1e-6):
        super().__init__()
        self.eps = eps
        self.weight = nn.Parameter(torch.ones(dim))

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        dtype = x.dtype
        x = x.float()
        x = x * torch.rsqrt(x.pow(2).mean(-1, keepdim=True) + self.eps)
        return (x.to(dtype)) * self.weight


def build_rope_cache(head_dim: int, max_len: int, theta: float,
                     device=None) -> tuple[torch.Tensor, torch.Tensor]:
    inv_freq = 1.0 / (theta ** (torch.arange(0, head_dim, 2, device=device).float()
                                / head_dim))
    t = torch.arange(max_len, device=device).float()
    freqs = torch.outer(t, inv_freq)            # (max_len, head_dim/2)
    return freqs.cos(), freqs.sin()


def apply_rope(x: torch.Tensor, cos: torch.Tensor,
               sin: torch.Tensor) -> torch.Tensor:
    """x: (B, n_head, T, head_dim); cos/sin: (T, head_dim/2)."""
    x1, x2 = x.chunk(2, dim=-1)
    cos = cos[None, None, :, :]
    sin = sin[None, None, :, :]
    return torch.cat([x1 * cos - x2 * sin, x2 * cos + x1 * sin], dim=-1)


class Attention(nn.Module):
    def __init__(self, cfg: NWPConfig):
        super().__init__()
        self.cfg = cfg
        self.n_head, self.n_kv_head = cfg.n_head, cfg.n_kv_head
        self.hd = cfg.head_dim
        self.n_rep = cfg.n_head // cfg.n_kv_head

        self.wq = nn.Linear(cfg.n_embd, cfg.n_head * self.hd, bias=False)
        self.wk = nn.Linear(cfg.n_embd, cfg.n_kv_head * self.hd, bias=False)
        self.wv = nn.Linear(cfg.n_embd, cfg.n_kv_head * self.hd, bias=False)
        self.wo = nn.Linear(cfg.n_head * self.hd, cfg.n_embd, bias=False)
        self.dropout = cfg.dropout

    def forward(self, x, cos, sin):
        B, T, _ = x.shape
        q = self.wq(x).view(B, T, self.n_head, self.hd).transpose(1, 2)
        k = self.wk(x).view(B, T, self.n_kv_head, self.hd).transpose(1, 2)
        v = self.wv(x).view(B, T, self.n_kv_head, self.hd).transpose(1, 2)

        q, k = apply_rope(q, cos, sin), apply_rope(k, cos, sin)

        if self.n_rep > 1:                       # expand KV heads to match Q
            k = k.repeat_interleave(self.n_rep, dim=1)
            v = v.repeat_interleave(self.n_rep, dim=1)

        if self.cfg.attn_impl == "sdpa":
            y = F.scaled_dot_product_attention(
                q, k, v, is_causal=True,
                dropout_p=self.dropout if self.training else 0.0)
        else:
            att = (q @ k.transpose(-2, -1)) / math.sqrt(self.hd)
            mask = torch.ones(T, T, dtype=torch.bool, device=x.device).tril()
            att = att.masked_fill(~mask, float("-inf"))
            att = F.softmax(att, dim=-1)
            y = att @ v

        y = y.transpose(1, 2).contiguous().view(B, T, -1)
        return self.wo(y)


class SwiGLU(nn.Module):
    def __init__(self, cfg: NWPConfig):
        super().__init__()
        h = cfg.ffn_hidden
        self.w_gate = nn.Linear(cfg.n_embd, h, bias=False)
        self.w_up = nn.Linear(cfg.n_embd, h, bias=False)
        self.w_down = nn.Linear(h, cfg.n_embd, bias=False)

    def forward(self, x):
        return self.w_down(F.silu(self.w_gate(x)) * self.w_up(x))


class Block(nn.Module):
    def __init__(self, cfg: NWPConfig):
        super().__init__()
        self.norm_attn = RMSNorm(cfg.n_embd)
        self.attn = Attention(cfg)
        self.norm_ffn = RMSNorm(cfg.n_embd)
        self.ffn = SwiGLU(cfg)
        self.drop = nn.Dropout(cfg.dropout)

    def forward(self, x, cos, sin):
        x = x + self.drop(self.attn(self.norm_attn(x), cos, sin))
        x = x + self.drop(self.ffn(self.norm_ffn(x)))
        return x


# ---------------------------------------------------------------------------

class NWPModel(nn.Module):
    def __init__(self, cfg: NWPConfig):
        super().__init__()
        self.cfg = cfg
        self.tok_emb = nn.Embedding(cfg.vocab_size, cfg.n_embd)
        self.drop = nn.Dropout(cfg.dropout)
        self.blocks = nn.ModuleList([Block(cfg) for _ in range(cfg.n_layer)])
        self.norm_out = RMSNorm(cfg.n_embd)
        self.lm_head = nn.Linear(cfg.n_embd, cfg.vocab_size, bias=False)
        if cfg.tie_embeddings:
            self.lm_head.weight = self.tok_emb.weight

        # RoPE tables sized generously so inference can exceed train context.
        cos, sin = build_rope_cache(cfg.head_dim, cfg.block_size * 4,
                                    cfg.rope_theta)
        self.register_buffer("rope_cos", cos, persistent=False)
        self.register_buffer("rope_sin", sin, persistent=False)

        self.apply(self._init_weights)
        # Scale residual-path projections by depth (GPT-2 trick) so activations
        # don't blow up as layers stack.
        for name, p in self.named_parameters():
            if name.endswith("wo.weight") or name.endswith("w_down.weight"):
                nn.init.normal_(p, mean=0.0,
                                std=0.02 / math.sqrt(2 * cfg.n_layer))

    def _init_weights(self, module):
        if isinstance(module, nn.Linear):
            nn.init.normal_(module.weight, mean=0.0, std=0.02)
            if module.bias is not None:
                nn.init.zeros_(module.bias)
        elif isinstance(module, nn.Embedding):
            nn.init.normal_(module.weight, mean=0.0, std=0.02)

    def num_params(self, non_embedding: bool = False) -> int:
        n = sum(p.numel() for p in self.parameters())
        if non_embedding:
            n -= self.tok_emb.weight.numel()
        return n

    def forward(self, idx: torch.Tensor,
                targets: torch.Tensor | None = None,
                last_only: bool = False):
        _, T = idx.shape
        cos = self.rope_cos[:T].to(idx.device)
        sin = self.rope_sin[:T].to(idx.device)

        x = self.drop(self.tok_emb(idx))
        for blk in self.blocks:
            x = blk(x, cos, sin)
        x = self.norm_out(x)

        if targets is not None:
            logits = self.lm_head(x)
            loss = F.cross_entropy(
                logits.view(-1, logits.size(-1)), targets.reshape(-1),
                ignore_index=-1)
            return logits, loss

        if last_only:
            # Inference only needs the final position; skipping the rest turns
            # a (B,T,16384) matmul into (B,1,16384).
            x = x[:, -1:, :]
        return self.lm_head(x), None

    @torch.no_grad()
    def predict_next(self, idx: torch.Tensor, top_k: int = 5,
                     temperature: float = 1.0):
        """Returns (top_k_ids, top_k_probs) for the next token."""
        idx = idx[:, -self.cfg.block_size:]
        logits, _ = self.forward(idx, last_only=True)
        logits = logits[:, -1, :] / max(temperature, 1e-6)
        probs = F.softmax(logits, dim=-1)
        return probs.topk(top_k, dim=-1)

    @torch.no_grad()
    def generate(self, idx: torch.Tensor, max_new_tokens: int,
                 temperature: float = 0.8, top_k: int | None = 40):
        for _ in range(max_new_tokens):
            cropped = idx[:, -self.cfg.block_size:]
            logits, _ = self.forward(cropped, last_only=True)
            logits = logits[:, -1, :] / max(temperature, 1e-6)
            if top_k is not None:
                v, _ = torch.topk(logits, min(top_k, logits.size(-1)))
                logits[logits < v[:, [-1]]] = -float("inf")
            probs = F.softmax(logits, dim=-1)
            idx = torch.cat([idx, torch.multinomial(probs, 1)], dim=1)
        return idx


# ---------------------------------------------------------------------------

PRESETS: dict[str, dict] = {
    # ~6M non-embedding params - smoke tests and CI
    "tiny": dict(n_layer=4, n_head=4, n_kv_head=2, n_embd=256, block_size=256),
    # ~26M non-embedding params - the shipped model
    "base": dict(n_layer=8, n_head=8, n_kv_head=4, n_embd=512, block_size=256),
    # ~85M non-embedding params - if a bigger machine is ever available
    "large": dict(n_layer=12, n_head=12, n_kv_head=4, n_embd=768, block_size=512),
}


def build_model(preset: str = "base", **overrides) -> NWPModel:
    cfg = NWPConfig(**{**PRESETS[preset], **overrides})
    return NWPModel(cfg)
