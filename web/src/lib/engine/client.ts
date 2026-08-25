"use client";

/**
 * Main-thread handle on the inference worker.
 *
 * The important behaviour here is request coalescing. Someone typing quickly
 * generates far more predict() calls than the model can serve, so we keep at
 * most one request in flight and remember only the newest pending one --
 * intermediate keystrokes are dropped rather than queued. Queueing them would
 * make suggestions lag further behind the caret the faster you type, which is
 * exactly backwards.
 */

import type {
  EngineMeta,
  LatticeNode,
  Prediction,
  SurprisalToken,
  WorkerRequest,
  WorkerResponse,
} from "./types";

type PendingPredict = {
  text: string;
  topK: number;
  temperature: number;
  window: number;
};

export class Engine {
  private worker: Worker;
  private seq = 0;
  private inFlight = false;
  private pending: PendingPredict | null = null;
  private latestPredictId = 0;

  private waiters = new Map<number, (r: WorkerResponse) => void>();

  meta: EngineMeta | null = null;
  onPrediction: ((p: Prediction) => void) | null = null;
  onError: ((message: string) => void) | null = null;

  private readyResolve!: () => void;
  private readyReject!: (e: Error) => void;
  readonly ready: Promise<void>;

  constructor() {
    this.worker = new Worker(new URL("./worker.ts", import.meta.url), {
      type: "module",
    });
    this.ready = new Promise((res, rej) => {
      this.readyResolve = res;
      this.readyReject = rej;
    });
    this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => this.handle(e.data);
    this.worker.onerror = (e) => this.readyReject(new Error(e.message));
  }

  private handle(msg: WorkerResponse) {
    if (msg.type === "ready") {
      this.meta = msg.meta;
      this.readyResolve();
      return;
    }

    if (msg.type === "error") {
      this.inFlight = false;
      this.drain();
      this.onError?.(msg.message);
      if (!this.meta) this.readyReject(new Error(msg.message));
      return;
    }

    if (msg.type === "prediction") {
      this.inFlight = false;
      // Drop anything superseded while it was computing.
      if (msg.id === this.latestPredictId) {
        const { type, id, ...rest } = msg;
        void type;
        void id;
        this.onPrediction?.(rest as Prediction);
      }
      this.drain();
      return;
    }

    const waiter = this.waiters.get(msg.id);
    if (waiter) {
      this.waiters.delete(msg.id);
      waiter(msg);
    }
  }

  private drain() {
    if (this.inFlight || !this.pending) return;
    const next = this.pending;
    this.pending = null;
    this.dispatchPredict(next);
  }

  private dispatchPredict(p: PendingPredict) {
    this.inFlight = true;
    this.latestPredictId = ++this.seq;
    this.send({ type: "predict", id: this.latestPredictId, ...p });
  }

  private send(msg: WorkerRequest) {
    this.worker.postMessage(msg);
  }

  async init(opts: {
    modelUrl: string;
    tokenizerUrl: string;
    wasmPath: string;
    contextLength: number;
  }) {
    this.send({ type: "init", ...opts });
    return this.ready;
  }

  /** Fire-and-forget; results arrive on onPrediction, stale ones never do. */
  predict(text: string, opts: { topK: number; temperature: number; window?: number }) {
    const req: PendingPredict = {
      text,
      topK: opts.topK,
      temperature: opts.temperature,
      window: opts.window ?? 128,
    };
    if (this.inFlight) {
      this.pending = req; // replace, don't queue
      return;
    }
    this.dispatchPredict(req);
  }

  private request<T extends WorkerResponse>(msg: Omit<WorkerRequest, "id">): Promise<T> {
    const id = ++this.seq;
    return new Promise<T>((resolve) => {
      this.waiters.set(id, (r) => resolve(r as T));
      this.send({ ...msg, id } as WorkerRequest);
    });
  }

  surprisal(text: string) {
    return this.request<
      Extract<WorkerResponse, { type: "surprisal" }>
    >({ type: "surprisal", text } as Omit<WorkerRequest, "id">);
  }

  lattice(text: string, width = 4, depth = 2) {
    return this.request<Extract<WorkerResponse, { type: "lattice" }>>({
      type: "lattice",
      text,
      width,
      depth,
    } as Omit<WorkerRequest, "id">);
  }

  continuation(text: string, steps: number, temperature: number) {
    return this.request<
      Extract<WorkerResponse, { type: "continuation" }>
    >({ type: "continuation", text, steps, temperature } as Omit<WorkerRequest, "id">);
  }

  dispose() {
    this.worker.terminate();
    this.waiters.clear();
  }
}

export type { EngineMeta, LatticeNode, Prediction, SurprisalToken };
