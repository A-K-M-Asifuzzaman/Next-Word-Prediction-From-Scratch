"""Corpus preparation for NWP-Core.

Downloads the training corpora, trains a byte-level BPE tokenizer from scratch,
and writes the tokenized stream to flat uint16 binary files that the training
loop memory-maps directly. Nothing here depends on torch.

Outputs (under ml/artifacts/):
    tokenizer/tokenizer.json    trained BPE tokenizer
    data/train.bin              uint16 token stream
    data/val.bin
    data/test.bin
    data/meta.json              vocab size, token counts, provenance
"""

from __future__ import annotations

import argparse
import json
import os
import time
from pathlib import Path

import numpy as np
from tokenizers import Tokenizer, decoders, models, pre_tokenizers, processors, trainers

ARTIFACTS = Path(__file__).resolve().parents[3] / "artifacts"
TOKENIZER_DIR = ARTIFACTS / "tokenizer"
DATA_DIR = ARTIFACTS / "data"

EOT = "<|endoftext|>"
PAD = "<|pad|>"
SPECIALS = [EOT, PAD]


# --------------------------------------------------------------------------
# corpus loading
# --------------------------------------------------------------------------

def load_wikitext() -> dict[str, list[str]]:
    """WikiText-103 raw. ~103M words of verified-good Wikipedia prose."""
    from datasets import load_dataset

    print("[data] loading wikitext-103-raw-v1 ...", flush=True)
    ds = load_dataset("Salesforce/wikitext", "wikitext-103-raw-v1")
    out = {}
    for split, key in (("train", "train"), ("val", "validation"), ("test", "test")):
        lines = [t for t in ds[key]["text"] if t.strip()]
        out[split] = lines
        print(f"[data]   wikitext/{split}: {len(lines):,} non-empty lines", flush=True)
    return out


def load_openwebtext(n_docs: int) -> list[str]:
    """A stream-sampled slice of OpenWebText for register diversity.

    WikiText alone is encyclopedic and formal; mixing in web prose keeps the
    model from predicting like an encyclopedia when the user writes casually.
    Failure here is non-fatal -- we just train on WikiText.
    """
    if n_docs <= 0:
        return []
    from datasets import load_dataset

    print(f"[data] streaming {n_docs:,} openwebtext docs ...", flush=True)
    # datasets>=5 dropped script loaders; both repos below serve parquet, and
    # streaming only pulls the leading shards rather than the full 24GB.
    for repo in ("Skylion007/openwebtext", "Bingsu/openwebtext_20p"):
        try:
            ds = load_dataset(repo, split="train", streaming=True)
            docs, t0 = [], time.time()
            for i, row in enumerate(ds):
                if i >= n_docs:
                    break
                txt = row["text"].strip()
                if txt:
                    docs.append(txt)
                if (i + 1) % 20000 == 0:
                    print(f"[data]   {i + 1:,} docs  ({time.time() - t0:.0f}s)",
                          flush=True)
            print(f"[data]   {repo}: {len(docs):,} docs", flush=True)
            return docs
        except Exception as exc:  # noqa: BLE001 - try the next mirror
            print(f"[data] !! {repo} failed ({type(exc).__name__}: {exc})", flush=True)

    print("[data] !! no web corpus available; continuing with wikitext only",
          flush=True)
    return []


# --------------------------------------------------------------------------
# tokenizer
# --------------------------------------------------------------------------

def train_tokenizer(sample: list[str], vocab_size: int) -> Tokenizer:
    """Byte-level BPE. Byte-level means no <unk> is ever needed: any input the
    user types, including emoji and code, round-trips exactly."""
    print(f"[tok] training byte-level BPE, vocab={vocab_size:,}, "
          f"on {len(sample):,} lines ...", flush=True)
    tok = Tokenizer(models.BPE(unk_token=None))
    tok.pre_tokenizer = pre_tokenizers.ByteLevel(add_prefix_space=False)
    tok.decoder = decoders.ByteLevel()
    tok.post_processor = processors.ByteLevel(trim_offsets=False)

    trainer = trainers.BpeTrainer(
        vocab_size=vocab_size,
        special_tokens=SPECIALS,
        show_progress=True,
        initial_alphabet=pre_tokenizers.ByteLevel.alphabet(),
        min_frequency=2,
    )
    t0 = time.time()
    tok.train_from_iterator(sample, trainer=trainer, length=len(sample))
    print(f"[tok] done in {time.time() - t0:.0f}s, "
          f"vocab={tok.get_vocab_size():,}", flush=True)
    return tok


def encode_to_bin(tok: Tokenizer, docs: list[str], path: Path,
                  batch: int = 2000) -> int:
    """Encode documents to a flat uint16 stream, EOT-delimited."""
    eot_id = tok.token_to_id(EOT)
    path.parent.mkdir(parents=True, exist_ok=True)
    total, t0 = 0, time.time()
    chunks: list[np.ndarray] = []

    with open(path, "wb") as fh:
        for i in range(0, len(docs), batch):
            encs = tok.encode_batch(docs[i:i + batch])
            for enc in encs:
                chunks.append(np.array(enc.ids + [eot_id], dtype=np.uint16))
            if len(chunks) >= 20000:
                arr = np.concatenate(chunks)
                arr.tofile(fh)
                total += arr.size
                chunks = []
                print(f"[enc] {path.name}: {total:,} tokens "
                      f"({time.time() - t0:.0f}s)", flush=True)
        if chunks:
            arr = np.concatenate(chunks)
            arr.tofile(fh)
            total += arr.size

    print(f"[enc] {path.name}: {total:,} tokens -> {path}", flush=True)
    return total


# --------------------------------------------------------------------------

def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--vocab-size", type=int, default=16384)
    ap.add_argument("--owt-docs", type=int, default=120_000,
                    help="OpenWebText documents to mix in (0 disables)")
    ap.add_argument("--tokenizer-sample", type=int, default=400_000,
                    help="lines sampled for BPE training")
    args = ap.parse_args()

    TOKENIZER_DIR.mkdir(parents=True, exist_ok=True)
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    wiki = load_wikitext()
    owt = load_openwebtext(args.owt_docs)

    # Hold out a slice of the web data for validation too, so val perplexity
    # reflects both registers the model is trained on.
    owt_val_n = min(2000, len(owt) // 50)
    owt_val, owt_train = owt[:owt_val_n], owt[owt_val_n:]

    train_docs = wiki["train"] + owt_train
    val_docs = wiki["val"] + owt_val
    test_docs = wiki["test"]

    print(f"[data] train docs={len(train_docs):,}  val={len(val_docs):,}  "
          f"test={len(test_docs):,}", flush=True)

    # Train BPE on an interleaved sample so web text influences the merges.
    step = max(1, len(train_docs) // args.tokenizer_sample)
    sample = train_docs[::step][:args.tokenizer_sample]
    tok = train_tokenizer(sample, args.vocab_size)
    tok.save(str(TOKENIZER_DIR / "tokenizer.json"))

    counts = {
        "train": encode_to_bin(tok, train_docs, DATA_DIR / "train.bin"),
        "val": encode_to_bin(tok, val_docs, DATA_DIR / "val.bin"),
        "test": encode_to_bin(tok, test_docs, DATA_DIR / "test.bin"),
    }

    meta = {
        "vocab_size": tok.get_vocab_size(),
        "eot_id": tok.token_to_id(EOT),
        "pad_id": tok.token_to_id(PAD),
        "dtype": "uint16",
        "tokens": counts,
        "sources": {
            "wikitext-103-raw-v1": {"train_lines": len(wiki["train"])},
            "openwebtext": {"docs": len(owt)},
        },
        "prepared_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
    }
    (DATA_DIR / "meta.json").write_text(json.dumps(meta, indent=2))
    print("\n[done] " + json.dumps(meta["tokens"], indent=2), flush=True)


if __name__ == "__main__":
    os.environ.setdefault("TOKENIZERS_PARALLELISM", "true")
    main()
