# NWP-Core

A next-word prediction transformer trained from scratch, quantised to int8, and
served to the browser — plus the writing app, analytics dashboard, and admin
console around it.

**Live: https://nwp-core.vercel.app**

A read-only demo account is open — sign in and start writing:

```
demo@nwpcore.dev / NwpCore!Demo2026
```

The admin console is role-gated. The first account to register becomes an
admin (`handle_new_user` in
[the RLS migration](supabase/migrations/20260824204807_rls_and_triggers.sql));
after that, promotion happens only from the admin panel, which routes through
an audited `SECURITY DEFINER` RPC.

---

## What it is

Most autocomplete shows you one word and hides the fact that the model produced
a probability distribution over 16,384 of them. NWP-Core shows the distribution:
the candidates and their actual probabilities, the entropy of the position in
bits, a two-level branch lattice of where the text could go, and a per-token
surprisal profile of everything you've written.

The model is not an API call. It is 19.5M parameters trained from scratch on
262M tokens, exported to ONNX, dynamically quantised to int8, and executed in a
Web Worker via WebAssembly. **Nothing you type leaves your machine.**

---

## Results

Model: 8-layer decoder-only transformer, d=384, 16,384-token vocabulary,
256-token context. 19.47M parameters total (13.18M non-embedding).

| metric | held-out (val) | test |
|---|---|---|
| loss | 3.344 | 3.469 |
| **perplexity** | **28.33** | **32.10** |
| top-1 accuracy | 39.6% | 38.2% |
| top-3 accuracy | 54.8% | 53.1% |
| **top-5 accuracy** | **60.7%** | **58.8%** |

Top-5 accuracy is the number that matters for an autocomplete: the word you
wanted is in the five shown roughly **3 times out of 5**. Loss went 9.76 → 3.34
(perplexity 17,280 → 28.3) over 16,000 steps and 7.8 hours on an Apple M3 Pro.

**Measured in-browser latency: 15–20 ms per prediction** (WASM, single thread).

### Quantisation

Shipping decision made by measurement, not default:

| variant | size | perplexity | Δppl | top-5 | Δtop-5 |
|---|---|---|---|---|---|
| fp32 | 103.5 MB | 32.10 | — | 58.80% | — |
| int8 (matmul) | 45.5 MB | 33.11 | +3.14% | 58.55% | −0.25pp |
| **int8 (matmul+embedding)** | **26.6 MB** | 33.10 | +3.13% | **58.53%** | **−0.27pp** |

A 3% perplexity rise sounds alarming and a 0.27-point top-5 drop does not — they
describe the same model. Top-5 is what a person experiences, so that is the gate
(`ml/scripts/stage_model.py`). Shipping int8 cuts the download 4× for a quarter
of a percentage point.

---

## Architecture

```
ml/                            training pipeline (PyTorch, MPS)
  src/nwp/
    data/prepare.py            corpus download → BPE training → uint16 token stream
    data/dataset.py            memory-mapped loader
    model/transformer.py       RMSNorm · RoPE · SwiGLU · GQA · tied embeddings
    train.py                   AdamW, cosine schedule, resumable, JSONL telemetry
    evaluate.py                perplexity + top-k for torch and every ONNX variant
    export_onnx.py             ONNX export, fp16/int8 variants, torch-parity check
  scripts/
    bench.py, bench_opt.py     throughput probes that decided the model shape
    stage_model.py             measurement-gated ship decision
    publish_run.py             pushes run + metrics + model registry to Postgres

web/                           Next.js 16 app (App Router)
  src/lib/engine/
    tokenizer.ts               byte-level BPE, verified byte-identical to Python
    worker.ts                  ONNX Runtime Web, off the main thread
    client.ts                  request coalescing (drop stale, never queue)
  src/app/(app)/workspace      the editor + instruments
  src/app/(app)/dashboard      per-user analytics
  src/app/(app)/admin/*        overview · training · models · users · telemetry · flags
  scripts/                     tokenizer parity, e2e (playwright), screenshots

supabase/                      schema, RLS, analytics RPCs
```

### Model

A modern-small decoder, not a GPT-2 reimplementation:

- **RMSNorm** — no bias term, cheaper than LayerNorm
- **RoPE** — relative positions; lets inference exceed the training context
- **SwiGLU** — better quality per parameter than a GELU MLP
- **Grouped-query attention** — 6 query heads to 2 KV heads, ⅓ the KV cache
- **Tied embeddings** — the input embedding *is* the output head; saves 6.3M
  parameters on a 16k vocab, which matters a lot at this scale

### Why this shape

Model size was chosen by measuring MPS throughput, not by guessing
(`ml/scripts/bench_opt.py`):

| shape | non-emb params | throughput | tokens/param in budget |
|---|---|---|---|
| L8 E512 | 23.6M | 7.1k tok/s | 6.4 — badly undertrained |
| L6 E512 | 17.7M | 7.9k tok/s | 9.7 |
| **L8 E384** | **13.2M** | **9.5k tok/s** | **26** ← chosen |
| L6 E384 | 9.9M | 11.3k tok/s | 34.7 |

Chinchilla puts the compute-optimal ratio near 20 tokens/parameter. L8 E384
lands just past it — the right side to err on when the model also has to be
downloaded and run inside a browser.

None of the usual micro-optimisations moved MPS throughput (`enable_gqa`,
native-dtype RMSNorm, `torch.compile` were all within noise). Model *shape* was
the only lever, which is why the benchmark drove the config.

---

## The interface

The design is an instrument, not a SaaS page: hairline technical grid, corner
bezel ticks, tabular monospace readouts, no gradients, no shadows, no
glassmorphism. Chrome is cold monospace; the text you write is warm serif. That
contrast is the whole idea — you write like a person, the machine annotates like
an instrument.

- **Distribution** — five candidates with real probabilities. A 12%-confident
  suggestion should not look like a 90%-confident one.
- **Lattice** — two levels of the continuation tree, edge weight ∝ conditional
  probability, node opacity ∝ joint probability along the path.
- **Surprisal scope** — every token scored by how many bits it cost the model.
  Flat is predictable; spikes are where you surprised it.
- **Readout** — entropy in bits, top surprisal, effective choices (2^H),
  acceptance rate, characters saved.

Colours are the validated categorical palette from the data-viz method: all
gates pass in both dark and light mode (worst adjacent CVD ΔE 8.4, normal-vision
ΔE 19.7). Light mode carries a sub-3:1 contrast warning on three series, so every
chart ships direct labels and a table view as the required relief.

---

## Security model

- **Row-level security on every table.** Users read only their own documents and
  prediction events; admins are widened by explicit policy, never by client code.
- A user can update their own profile, but the `WITH CHECK` re-reads `role` and
  `status` from the existing row, so **self-promotion to admin is impossible**.
- Admin mutations go through `SECURITY DEFINER` RPCs that re-check `is_admin()`
  and write an `audit_log` row — a role change is never an untraced `UPDATE`.
- `/admin` is gated in `proxy.ts` *and* in the layout *and* by RLS. The first two
  are convenience; RLS is the boundary.
- API keys are stored as SHA-256 hashes. The raw key is shown exactly once.
- Trigger functions and admin RPCs have `EXECUTE` revoked from `anon`.
- No service-role key exists anywhere in this repo. Even the training-metrics
  publisher authenticates as an admin user and goes through RLS.

---

## Reproducing

```bash
# 0. environment
uv venv --python 3.12 --system-site-packages .venv
uv pip install --python .venv/bin/python datasets onnx onnxruntime fastapi \
    tqdm matplotlib pyyaml huggingface_hub onnxconverter-common

# 1. corpus: download, train BPE, write uint16 token stream  (~5 min)
.venv/bin/python ml/src/nwp/data/prepare.py --vocab-size 16384 --owt-docs 120000

# 2. size the run to your hardware
.venv/bin/python ml/scripts/bench_opt.py

# 3. train  (~7.8h on an M3 Pro; resumable with --resume)
.venv/bin/python ml/src/nwp/train.py --config ml/config/base.yaml

# 4. export ONNX variants and verify against torch on real text
.venv/bin/python ml/src/nwp/export_onnx.py

# 5. measure every variant, then stage the smallest that clears the top-5 budget
.venv/bin/python ml/src/nwp/evaluate.py --split test
.venv/bin/python ml/scripts/stage_model.py

# 6. publish run + model registry to Postgres
NWP_ADMIN_EMAIL=... NWP_ADMIN_PASSWORD=... \
  .venv/bin/python ml/scripts/publish_run.py --status complete

# 7. web
cd web && npm install && node scripts/stage-ort.mjs && npm run dev
```

### Tests

```bash
cd web
node --experimental-strip-types scripts/tokenizer-parity.ts cases.json  # 138/138
node scripts/e2e.mjs http://localhost:3000                             # 14/14
node scripts/e2e-admin.mjs http://localhost:3000                       #  9/9
```

The **tokenizer parity harness** is the one test that must never fail. The
browser tokenizer is a reimplementation of the Python one the model was trained
with; if they disagree on a single merge, the model is fed ids it never saw in
training and the predictions quietly degrade with no error anywhere. It is
verified against 24,241 tokens spanning emoji, CJK, Cyrillic, whitespace edge
cases, and 120 real corpus samples.

---

## Deployment

| piece | where | note |
|---|---|---|
| app + API | Vercel | Next.js 16, `proxy.ts` (renamed from middleware in v16) |
| database, auth | Supabase | Postgres 17, `ap-southeast-1` |
| model weights | Vercel CDN | 26.6 MB, `immutable`, one-time download |
| inference | **the visitor's browser** | ONNX Runtime Web, WASM SIMD, Web Worker |

There is no inference server. Serving the model costs a static file fetch, and
prediction cost scales with users at exactly zero marginal compute.

Pushes to `main` deploy automatically. Vercel's **Root Directory is `web`**,
since the Next.js app is a subdirectory of this repo.

The trained `.onnx` weights are committed — reproducing them takes about eight
hours of training, which makes "regenerable" true in principle and useless in
practice. The ONNX Runtime `.wasm` binaries are *not* committed; they are
copied out of `node_modules` by `scripts/stage-ort.mjs`, which runs on both
`postinstall` and `build`.

### Environment

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
```

---

## Known limitations

- **262M training tokens is under one epoch of the corpus** and well below what
  this architecture could absorb. Held-out loss still tracks train loss with no
  separation — the model is underfitting, not overfitting, which is why dropout
  is 0. More compute would still help.
- The 256-token context is ample for next-word prediction but the model has no
  KV cache in the ONNX graph, so `extend` re-runs the full prefix per token.
- Quantisation to int8 costs 0.27pp of top-5 accuracy. Documented, not hidden.
- The exported graph emits full logits `[1, T, vocab]`, wasting some LM-head
  compute on the prediction path. Paid deliberately: it is what makes the
  surprisal scope possible from the same single download.
- Leaked-password protection is off in Supabase Auth (a dashboard toggle).
