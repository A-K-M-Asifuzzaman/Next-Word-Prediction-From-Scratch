import Link from "next/link";

import { Panel, Readout } from "@/components/instrument/Panel";
import { ThemeToggle } from "@/components/instrument/Nav";
import { LiveDemo } from "@/components/predict/LiveDemo";
import { compact, nf } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export default async function Landing() {
  const supabase = await createClient();
  const [{ data: user }, { data: model }] = await Promise.all([
    supabase.auth.getUser(),
    supabase
      .from("models")
      .select("*")
      .eq("status", "active")
      .maybeSingle(),
  ]);

  const signedIn = Boolean(user?.user);

  return (
    <div className="grid-plane min-h-dvh">
      {/* ------------------------------------------------------------- rail */}
      <header className="sticky top-0 z-40 border-b border-[var(--hairline)] bg-[var(--plane)]/95 px-4 backdrop-blur-sm">
        <div className="mx-auto flex h-11 max-w-6xl items-center gap-5">
          <span className="text-[13px] font-semibold tracking-tight">
            NWP<span className="text-[var(--signal)]">//</span>CORE
          </span>
          <span className="hidden text-[10px] tracking-[0.14em] text-[var(--ink-muted)] uppercase sm:block">
            next-word prediction · trained from scratch
          </span>
          <div className="ml-auto flex items-center gap-4">
            <ThemeToggle />
            {signedIn ? (
              <Link href="/workspace" className="label hover:text-[var(--signal)]">
                workspace →
              </Link>
            ) : (
              <>
                <Link href="/login" className="label hover:text-[var(--signal)]">
                  sign in
                </Link>
                <Link
                  href="/signup"
                  className="border border-[var(--signal)] px-2.5 py-1 text-[10px] tracking-[0.12em] text-[var(--signal)] uppercase hover:bg-[var(--signal)] hover:text-[var(--plane)]"
                >
                  get access
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4">
        {/* ------------------------------------------------------------ hero */}
        <section className="grid gap-8 py-14 lg:grid-cols-[minmax(0,1fr)_300px] lg:py-20">
          <div>
            <p className="label mb-4 text-[var(--signal)]">
              ── 19.5M parameters · 262M training tokens · 0 servers
            </p>
            <h1 className="font-sans text-[40px] leading-[1.02] font-medium tracking-[-0.03em] sm:text-[58px]">
              A language model
              <br />
              doesn&apos;t guess a word.
              <br />
              <span className="text-[var(--ink-muted)]">
                It has a distribution.
              </span>
            </h1>
            <p className="mt-6 max-w-xl font-sans text-[15px] leading-relaxed text-[var(--ink-2)]">
              Most autocomplete hides that. NWP-Core shows it: every keystroke,
              the full probability mass over what comes next, the branch tree two
              tokens deep, and a surprisal profile of your own prose. The
              transformer was trained from scratch, quantised to int8, and runs
              entirely inside this tab.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href={signedIn ? "/workspace" : "/signup"}
                className="ticked border border-[var(--signal)] bg-[var(--signal-wash)] px-5 py-2.5 text-[11px] tracking-[0.14em] text-[var(--signal)] uppercase transition-colors hover:bg-[var(--signal)] hover:text-[var(--plane)]"
              >
                {signedIn ? "open workspace" : "start writing"} →
              </Link>
              <a
                href="#architecture"
                className="border border-[var(--hairline)] px-5 py-2.5 text-[11px] tracking-[0.14em] uppercase transition-colors hover:border-[var(--ink-2)]"
              >
                how it was built
              </a>
            </div>
          </div>

          <Panel label="specimen" className="self-start">
            <Readout k="architecture" v="decoder-only" tone="muted" />
            <Readout
              k="parameters"
              v={model?.params_total ? compact(model.params_total) : "19.5M"}
              tone="signal"
            />
            <Readout
              k="non-embedding"
              v={
                model?.params_non_embedding
                  ? compact(model.params_non_embedding)
                  : "13.2M"
              }
            />
            <Readout k="vocabulary" v={nf.format(model?.vocab_size ?? 16384)} />
            <Readout k="context" v={`${model?.context_length ?? 256} tok`} />
            <div className="rule my-2" />
            <Readout
              k="perplexity"
              v={model?.perplexity ? Number(model.perplexity).toFixed(1) : "—"}
            />
            <Readout
              k="top-5 accuracy"
              v={model?.top5 ? `${(Number(model.top5) * 100).toFixed(1)}%` : "—"}
            />
            <Readout
              k="download"
              v={
                model?.size_bytes
                  ? `${(model.size_bytes / 1e6).toFixed(1)}MB`
                  : "26.6MB"
              }
            />
            <div className="rule my-2" />
            <Readout k="inference" v="wasm · local" tone="muted" />
            <Readout k="data leaves device" v="never" tone="good" />
          </Panel>
        </section>

        {/* ------------------------------------------------------------ demo */}
        <section className="pb-16">
          <LiveDemo />
        </section>

        {/* ---------------------------------------------------- architecture */}
        <section id="architecture" className="border-t border-[var(--hairline)] py-16">
          <p className="label mb-3 text-[var(--signal)]">── the build</p>
          <h2 className="mb-10 max-w-2xl font-sans text-[30px] leading-tight font-medium tracking-tight">
            Corpus to browser, end to end.
          </h2>

          <ol className="grid gap-px bg-[var(--hairline)] md:grid-cols-2 lg:grid-cols-4">
            {[
              {
                n: "01",
                t: "corpus",
                d: "WikiText-103 plus a 120k-document slice of OpenWebText, so the model sees both encyclopedic and casual register. A byte-level BPE tokenizer is trained from scratch to a 16,384-word vocabulary, then the whole corpus is written out as a flat uint16 stream.",
                m: "269,874,330 tokens",
              },
              {
                n: "02",
                t: "architecture",
                d: "A decoder-only transformer: RMSNorm, rotary position embeddings, SwiGLU feed-forward, grouped-query attention with 6 query heads to 2 KV heads, and the embedding matrix tied to the output head.",
                m: "8 layers · d=384",
              },
              {
                n: "03",
                t: "training",
                d: "AdamW with decoupled weight decay on matmul weights only, 500-step warmup into a cosine decay, gradient clipping at 1.0, bf16 autocast on Apple Silicon. Model shape was chosen by measuring throughput, not by guessing.",
                m: "16,000 steps · 262M tokens",
              },
              {
                n: "04",
                t: "deployment",
                d: "Exported to ONNX, then dynamically quantised to int8 with per-channel scales — which costs 0.08% perplexity and cuts the download from 103MB to 26.6MB. It runs in a Web Worker so the caret never stutters.",
                m: "26.6MB · int8",
              },
            ].map((s) => (
              <li key={s.n} className="bg-[var(--surface-1)] p-5">
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-[11px] text-[var(--signal)]">
                    {s.n}
                  </span>
                  <span className="label">{s.t}</span>
                </div>
                <p className="mt-3 text-[12px] leading-relaxed text-[var(--ink-2)]">
                  {s.d}
                </p>
                <p className="mt-3 border-t border-[var(--hairline)] pt-2 font-mono text-[11px] tabular-nums text-[var(--ink-1)]">
                  {s.m}
                </p>
              </li>
            ))}
          </ol>
        </section>

        {/* -------------------------------------------------------- features */}
        <section className="border-t border-[var(--hairline)] py-16">
          <div className="grid gap-px bg-[var(--hairline)] md:grid-cols-3">
            {[
              {
                t: "the distribution, not the guess",
                d: "Five candidates with their actual probabilities, the entropy of the position in bits, and the number of effective choices. A 12%-confident suggestion should not look like a 90%-confident one.",
              },
              {
                t: "a branch lattice",
                d: "Two levels of the continuation tree, drawn with edge weights proportional to conditional probability. It is the only view in the app that shows what the model is doing rather than what it decided.",
              },
              {
                t: "surprisal profiling",
                d: "Every token in your document scored by how many bits it cost the model. Flat means predictable; spikes are where you surprised it. A profile of your prose against a language model's expectations.",
              },
              {
                t: "nothing leaves the device",
                d: "The weights come to you, not your text to a server. Telemetry records latency, entropy and whether you accepted — never a character of what you wrote.",
              },
              {
                t: "real telemetry",
                d: "Acceptance rate, characters saved, latency percentiles, per-token accept rates — computed in Postgres from your own events, scoped by row-level security.",
              },
              {
                t: "a model registry",
                d: "Every export lands in a versioned registry with its perplexity and accuracy. Promoting a new model demotes the incumbent in one transaction and writes an audit entry.",
              },
            ].map((f) => (
              <div key={f.t} className="bg-[var(--surface-1)] p-5">
                <h3 className="font-sans text-[14px] font-medium tracking-tight">
                  {f.t}
                </h3>
                <p className="mt-2 text-[12px] leading-relaxed text-[var(--ink-2)]">
                  {f.d}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className="border-t border-[var(--hairline)] py-16 text-center">
          <h2 className="font-sans text-[28px] leading-tight font-medium tracking-tight">
            Watch a model think in real time.
          </h2>
          <Link
            href={signedIn ? "/workspace" : "/signup"}
            className="ticked mt-6 inline-block border border-[var(--signal)] bg-[var(--signal-wash)] px-6 py-3 text-[11px] tracking-[0.14em] text-[var(--signal)] uppercase transition-colors hover:bg-[var(--signal)] hover:text-[var(--plane)]"
          >
            {signedIn ? "open workspace" : "create an account"} →
          </Link>
        </section>
      </main>

      <footer className="border-t border-[var(--hairline)] px-4 py-6">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 text-[10px] text-[var(--ink-muted)]">
          <span>
            NWP//CORE · transformer trained from scratch · inference in
            WebAssembly
          </span>
          <span className="font-mono">
            wikitext-103 + openwebtext · cc-by-sa / cc0
          </span>
        </div>
      </footer>
    </div>
  );
}
