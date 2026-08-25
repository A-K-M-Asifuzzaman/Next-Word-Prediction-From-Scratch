/// <reference lib="webworker" />
/**
 * Inference worker.
 *
 * Everything model-related lives off the main thread: a forward pass through
 * NWP-Core in WASM takes tens of milliseconds, and doing that inline would
 * stutter the caret on every keystroke.
 *
 * The exported graph emits full logits, shape [1, T, vocab]. The prediction
 * path reads only the final row, which costs some wasted lm_head compute --
 * paid deliberately, because it is what makes the per-token surprisal strip
 * possible from the same single model download.
 */

// The default `onnxruntime-web` entry is the full build, which fetches the
// JSEP (WebGPU) artifacts even when only the wasm provider is requested --
// a 404 on ort-wasm-simd-threaded.jsep.mjs and a session that never starts.
// The `/wasm` subpath is the CPU-only build: correct artifacts, half the size.
import * as ort from "onnxruntime-web/wasm";

import { BPETokenizer } from "./tokenizer";
import type { LatticeNode, WorkerRequest, WorkerResponse } from "./types";

const ctx = self as unknown as DedicatedWorkerGlobalScope;

let session: ort.InferenceSession | null = null;
let tokenizer: BPETokenizer | null = null;
let contextLength = 256;
let vocabSize = 0;

function post(msg: WorkerResponse) {
  ctx.postMessage(msg);
}

/** Numerically stable softmax over one logits row, with temperature. */
function softmax(row: Float32Array, temperature: number): Float32Array {
  const t = Math.max(temperature, 1e-6);
  let max = -Infinity;
  for (let i = 0; i < row.length; i++) {
    const v = row[i] / t;
    if (v > max) max = v;
  }
  const out = new Float32Array(row.length);
  let sum = 0;
  for (let i = 0; i < row.length; i++) {
    const e = Math.exp(row[i] / t - max);
    out[i] = e;
    sum += e;
  }
  for (let i = 0; i < row.length; i++) out[i] /= sum;
  return out;
}

/** Partial selection - full sort of 16k candidates on every keystroke is waste. */
function topK(probs: Float32Array, k: number): { id: number; prob: number }[] {
  const best: { id: number; prob: number }[] = [];
  let floor = -Infinity;
  for (let i = 0; i < probs.length; i++) {
    const p = probs[i];
    if (best.length < k) {
      best.push({ id: i, prob: p });
      if (best.length === k) {
        best.sort((a, b) => b.prob - a.prob);
        floor = best[k - 1].prob;
      }
    } else if (p > floor) {
      best[k - 1] = { id: i, prob: p };
      let j = k - 1;
      while (j > 0 && best[j].prob > best[j - 1].prob) {
        [best[j], best[j - 1]] = [best[j - 1], best[j]];
        j--;
      }
      floor = best[k - 1].prob;
    }
  }
  best.sort((a, b) => b.prob - a.prob);
  return best;
}

function entropyBits(probs: Float32Array): number {
  let h = 0;
  for (let i = 0; i < probs.length; i++) {
    const p = probs[i];
    if (p > 1e-9) h -= p * Math.log2(p);
  }
  return h;
}

async function run(ids: number[]): Promise<{ data: Float32Array; T: number }> {
  if (!session) throw new Error("session not initialised");
  const T = ids.length;
  const input = new ort.Tensor(
    "int64",
    BigInt64Array.from(ids, (v) => BigInt(v)),
    [1, T],
  );
  const feeds: Record<string, ort.Tensor> = {};
  feeds[session.inputNames[0]] = input;
  const out = await session.run(feeds);
  const logits = out[session.outputNames[0]];
  return { data: logits.data as Float32Array, T };
}

async function handleInit(msg: Extract<WorkerRequest, { type: "init" }>) {
  const t0 = performance.now();

  ort.env.wasm.wasmPaths = msg.wasmPath;
  // Threads need cross-origin isolation, which we don't set; SIMD alone still
  // gives most of the win and works everywhere.
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.simd = true;
  ort.env.logLevel = "error";

  contextLength = msg.contextLength;

  const [tok, modelBuf] = await Promise.all([
    BPETokenizer.load(msg.tokenizerUrl),
    fetch(msg.modelUrl).then((r) => {
      if (!r.ok) throw new Error(`model fetch failed: ${r.status}`);
      return r.arrayBuffer();
    }),
  ]);

  tokenizer = tok;
  session = await ort.InferenceSession.create(modelBuf, {
    executionProviders: ["wasm"],
    graphOptimizationLevel: "all",
  });

  // One warm pass so the first real keystroke isn't paying JIT costs.
  const warm = await run([0, 1, 2, 3]);
  vocabSize = warm.data.length / warm.T;

  post({
    type: "ready",
    meta: {
      vocabSize,
      contextLength,
      modelBytes: modelBuf.byteLength,
      loadMs: Math.round(performance.now() - t0),
      backend: "wasm",
    },
  });
}

async function handlePredict(msg: Extract<WorkerRequest, { type: "predict" }>) {
  if (!session || !tokenizer) return;
  const t0 = performance.now();

  let ids = tokenizer.encode(msg.text);
  const window = Math.min(msg.window, contextLength);
  if (ids.length > window) ids = ids.slice(-window);
  // The model has no BOS; an empty prefix gets the EOT token so it predicts
  // document-initial words rather than being handed a zero-length sequence.
  if (ids.length === 0) ids = [0];

  const { data, T } = await run(ids);
  const V = data.length / T;
  const lastRow = data.subarray((T - 1) * V, T * V);

  const probs = softmax(lastRow as Float32Array, msg.temperature);
  const picks = topK(probs, msg.topK);

  post({
    type: "prediction",
    id: msg.id,
    candidates: picks.map((p) => ({
      id: p.id,
      text: tokenizer!.decodeToken(p.id),
      prob: p.prob,
      startsWord: tokenizer!.startsWord(p.id),
    })),
    entropy: entropyBits(probs),
    topSurprisal: picks.length ? -Math.log2(Math.max(picks[0].prob, 1e-9)) : 0,
    latencyMs: performance.now() - t0,
    contextTokens: ids.length,
  });
}

/**
 * Per-token surprisal over the visible text: for each position we read the
 * distribution the model had *before* seeing that token, then report how many
 * bits the actual token cost. This is the data behind the scope strip.
 */
async function handleSurprisal(msg: Extract<WorkerRequest, { type: "surprisal" }>) {
  if (!session || !tokenizer) return;

  let ids = tokenizer.encode(msg.text);
  if (ids.length < 2) {
    post({ type: "surprisal", id: msg.id, tokens: [], meanSurprisal: 0 });
    return;
  }
  if (ids.length > contextLength) ids = ids.slice(-contextLength);

  const { data, T } = await run(ids);
  const V = data.length / T;

  const tokens = [];
  let total = 0;
  for (let i = 1; i < T; i++) {
    const row = data.subarray((i - 1) * V, i * V) as Float32Array;
    const probs = softmax(row, 1.0);
    const s = -Math.log2(Math.max(probs[ids[i]], 1e-9));
    total += s;
    tokens.push({ text: tokenizer.decodeToken(ids[i]), surprisal: s });
  }

  post({
    type: "surprisal",
    id: msg.id,
    tokens,
    meanSurprisal: total / Math.max(tokens.length, 1),
  });
}

/**
 * Depth-limited branch tree: the top `width` next tokens, then each of those
 * expanded one level further. Done inside the worker so the whole tree is one
 * round trip rather than `width + 1` message hops.
 *
 * Cost is (1 + width) forward passes, which is why the UI only asks for this
 * once typing settles, never on every keystroke.
 */
async function handleLattice(msg: Extract<WorkerRequest, { type: "lattice" }>) {
  if (!session || !tokenizer) return;
  const t0 = performance.now();

  const base = tokenizer.encode(msg.text);
  const nodes: LatticeNode[] = [];

  async function expand(prefix: number[], parent: string | null,
                        parentJoint: number, depth: number, width: number) {
    if (depth > msg.depth) return;
    const window = prefix.slice(-contextLength);
    const { data, T } = await run(window.length ? window : [0]);
    const V = data.length / T;
    const probs = softmax(data.subarray((T - 1) * V, T * V) as Float32Array, 1.0);

    for (const pick of topK(probs, width)) {
      const key = `${parent ?? "r"}/${pick.id}`;
      const joint = parentJoint * pick.prob;
      nodes.push({
        key,
        parent,
        token: tokenizer!.decodeToken(pick.id),
        prob: pick.prob,
        joint,
        depth,
      });
      if (depth < msg.depth) {
        // Narrow as we go deeper: a uniform fan-out buys mostly noise.
        await expand([...prefix, pick.id], key, joint, depth + 1,
                     Math.max(2, width - 2));
      }
    }
  }

  await expand(base, null, 1, 1, msg.width);
  post({ type: "lattice", id: msg.id, nodes,
         latencyMs: performance.now() - t0 });
}

/** Greedy-with-temperature rollout, used by the "extend" affordance. */
async function handleContinuation(
  msg: Extract<WorkerRequest, { type: "continuation" }>,
) {
  if (!session || !tokenizer) return;
  const t0 = performance.now();

  let ids = tokenizer.encode(msg.text);
  if (ids.length === 0) ids = [0];
  const generated: number[] = [];

  for (let step = 0; step < msg.steps; step++) {
    const window = ids.slice(-contextLength);
    const { data, T } = await run(window);
    const V = data.length / T;
    const probs = softmax(data.subarray((T - 1) * V, T * V) as Float32Array,
                          msg.temperature);

    // Nucleus-style truncation to the top 20, then sample.
    const picks = topK(probs, 20);
    const mass = picks.reduce((a, p) => a + p.prob, 0);
    let r = Math.random() * mass;
    let chosen = picks[0].id;
    for (const p of picks) {
      r -= p.prob;
      if (r <= 0) {
        chosen = p.id;
        break;
      }
    }
    if (chosen === 0) break; // end-of-text
    ids.push(chosen);
    generated.push(chosen);
  }

  post({
    type: "continuation",
    id: msg.id,
    text: tokenizer.decode(generated),
    latencyMs: performance.now() - t0,
  });
}

ctx.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  try {
    switch (msg.type) {
      case "init":
        await handleInit(msg);
        break;
      case "predict":
        await handlePredict(msg);
        break;
      case "surprisal":
        await handleSurprisal(msg);
        break;
      case "lattice":
        await handleLattice(msg);
        break;
      case "continuation":
        await handleContinuation(msg);
        break;
    }
  } catch (err) {
    post({
      type: "error",
      id: "id" in msg ? msg.id : undefined,
      message: err instanceof Error ? err.message : String(err),
    });
  }
};
