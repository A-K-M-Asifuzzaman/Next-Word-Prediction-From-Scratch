/**
 * Copies the ONNX Runtime WASM binaries into public/ort/.
 *
 * They have to be served as static files rather than bundled: the worker sets
 * ort.env.wasm.wasmPaths to this directory and the runtime fetches them at
 * load time. Only the plain SIMD build is staged -- the jsep/jspi/asyncify
 * variants are for WebGPU and stack-switching, which we don't request, and
 * together they'd add ~67MB to the deployment.
 */
import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const from = join(root, "node_modules", "onnxruntime-web", "dist");
const to = join(root, "public", "ort");

const FILES = ["ort-wasm-simd-threaded.wasm", "ort-wasm-simd-threaded.mjs"];

mkdirSync(to, { recursive: true });
for (const f of FILES) {
  const src = join(from, f);
  if (!existsSync(src)) {
    console.error(`[stage-ort] missing ${src}`);
    process.exit(1);
  }
  copyFileSync(src, join(to, f));
  console.log(`[stage-ort] ${f}`);
}
