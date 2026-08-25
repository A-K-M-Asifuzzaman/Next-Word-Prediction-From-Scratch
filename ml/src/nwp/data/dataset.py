"""Memory-mapped token-stream loader.

The prepared corpus is a flat uint16 file of ~250M tokens (~500MB). We never
load it into RAM: np.memmap lets the OS page in only the windows we sample,
so training holds a near-constant resident set regardless of corpus size.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import torch


class TokenStream:
    def __init__(self, data_dir: str | Path, split: str, block_size: int):
        self.path = Path(data_dir) / f"{split}.bin"
        if not self.path.exists():
            raise FileNotFoundError(
                f"{self.path} missing - run `python src/nwp/data/prepare.py` first")
        self.block_size = block_size
        self.data = np.memmap(self.path, dtype=np.uint16, mode="r")
        self.n_tokens = len(self.data)
        if self.n_tokens <= block_size + 1:
            raise ValueError(f"{split}.bin has only {self.n_tokens} tokens")

    def __len__(self) -> int:
        return self.n_tokens

    def batch(self, batch_size: int, device: torch.device,
              generator: np.random.Generator | None = None):
        """Random contiguous windows. For LM pretraining, uniform random offsets
        into the stream are equivalent to shuffling and avoid an index array
        the size of the corpus."""
        rng = generator if generator is not None else np.random.default_rng()
        ix = rng.integers(0, self.n_tokens - self.block_size - 1,
                          size=batch_size)
        x = np.stack([self.data[i:i + self.block_size] for i in ix])
        y = np.stack([self.data[i + 1:i + 1 + self.block_size] for i in ix])
        x = torch.from_numpy(x.astype(np.int64))
        y = torch.from_numpy(y.astype(np.int64))
        if device.type == "mps":
            return x.to(device, non_blocking=True), y.to(device, non_blocking=True)
        return x.pin_memory().to(device, non_blocking=True), \
            y.pin_memory().to(device, non_blocking=True)

    def sequential_batches(self, batch_size: int, device: torch.device,
                           max_batches: int | None = None):
        """Non-overlapping sweep - used for honest held-out perplexity."""
        stride = self.block_size
        starts = np.arange(0, self.n_tokens - self.block_size - 1, stride)
        if max_batches is not None:
            starts = starts[:max_batches * batch_size]
        for i in range(0, len(starts), batch_size):
            chunk = starts[i:i + batch_size]
            x = np.stack([self.data[s:s + self.block_size] for s in chunk])
            y = np.stack([self.data[s + 1:s + 1 + self.block_size] for s in chunk])
            yield (torch.from_numpy(x.astype(np.int64)).to(device),
                   torch.from_numpy(y.astype(np.int64)).to(device))


def load_meta(data_dir: str | Path) -> dict:
    return json.loads((Path(data_dir) / "meta.json").read_text())
