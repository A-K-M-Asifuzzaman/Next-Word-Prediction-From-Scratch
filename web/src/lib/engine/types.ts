export type Candidate = {
  id: number;
  /** Rendered surface form, e.g. " lazy" (leading space preserved). */
  text: string;
  prob: number;
  startsWord: boolean;
};

export type Prediction = {
  candidates: Candidate[];
  /** Shannon entropy of the full next-token distribution, in bits. */
  entropy: number;
  /** Bits needed to encode the top choice - low means the model is confident. */
  topSurprisal: number;
  latencyMs: number;
  contextTokens: number;
};

export type SurprisalToken = {
  text: string;
  /** -log2 p(token | prefix). High = the model did not see this coming. */
  surprisal: number;
};

export type EngineMeta = {
  vocabSize: number;
  contextLength: number;
  modelBytes: number;
  loadMs: number;
  backend: string;
};

/** One node of the branch tree drawn in the lattice view. */
export type LatticeNode = {
  key: string;
  parent: string | null;
  token: string;
  /** p(token | its own prefix) */
  prob: number;
  /** product of probs along the path from the root */
  joint: number;
  depth: number;
};

export type WorkerRequest =
  | {
      type: "init";
      modelUrl: string;
      tokenizerUrl: string;
      wasmPath: string;
      contextLength: number;
    }
  | { type: "lattice"; id: number; text: string; width: number; depth: number }
  | {
      type: "predict";
      id: number;
      text: string;
      topK: number;
      temperature: number;
      window: number;
    }
  | { type: "surprisal"; id: number; text: string }
  | { type: "continuation"; id: number; text: string; steps: number; temperature: number };

export type WorkerResponse =
  | { type: "ready"; meta: EngineMeta }
  | { type: "error"; id?: number; message: string }
  | ({ type: "prediction"; id: number } & Prediction)
  | { type: "surprisal"; id: number; tokens: SurprisalToken[]; meanSurprisal: number }
  | { type: "lattice"; id: number; nodes: LatticeNode[]; latencyMs: number }
  | { type: "continuation"; id: number; text: string; latencyMs: number };
