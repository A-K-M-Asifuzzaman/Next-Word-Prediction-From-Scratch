/**
 * Byte-level BPE tokenizer, ported to run in the browser.
 *
 * This has to be a faithful reimplementation of the `tokenizers` byte-level BPE
 * we trained in Python: if the browser produces different ids than training
 * did, the model sees garbage. The three pieces that must match exactly are
 * the byte<->unicode table, the pre-tokenizer regex, and the merge ranking.
 */

export type TokenizerJSON = {
  model: {
    vocab: Record<string, number>;
    merges: (string | [string, string])[];
  };
  added_tokens?: { id: number; content: string }[];
};

/**
 * GPT-2's bytes_to_unicode. Maps all 256 byte values onto printable unicode
 * codepoints so BPE operates on strings without ever meeting a control char
 * or an invalid UTF-8 sequence.
 */
function bytesToUnicode(): Map<number, string> {
  const bs: number[] = [];
  for (let i = 0x21; i <= 0x7e; i++) bs.push(i); // ! .. ~
  for (let i = 0xa1; i <= 0xac; i++) bs.push(i); // ¡ .. ¬
  for (let i = 0xae; i <= 0xff; i++) bs.push(i); // ® .. ÿ

  const present = new Set(bs);
  const cs = [...bs];
  let n = 0;
  for (let b = 0; b < 256; b++) {
    if (!present.has(b)) {
      bs.push(b);
      cs.push(256 + n);
      n++;
    }
  }
  const out = new Map<number, string>();
  bs.forEach((b, i) => out.set(b, String.fromCodePoint(cs[i])));
  return out;
}

// The ByteLevel pre-tokenizer split. Contractions, then letter runs, then
// digit runs, then punctuation runs, then whitespace -- each optionally
// carrying one leading space, which is how BPE learns word boundaries.
const SPLIT_PATTERN =
  /'s|'t|'re|'ve|'m|'ll|'d| ?\p{L}+| ?\p{N}+| ?[^\s\p{L}\p{N}]+|\s+(?!\S)|\s+/gu;

export class BPETokenizer {
  private vocab: Map<string, number>;
  private inverseVocab: Map<number, string>;
  private ranks: Map<string, number>;
  private byteEncoder: Map<number, string>;
  private byteDecoder: Map<string, number>;
  private cache = new Map<string, string[]>();
  private encoder = new TextEncoder();
  private decoder = new TextDecoder("utf-8", { fatal: false });

  readonly vocabSize: number;

  constructor(json: TokenizerJSON) {
    this.vocab = new Map(Object.entries(json.model.vocab));
    this.inverseVocab = new Map();
    for (const [tok, id] of this.vocab) this.inverseVocab.set(id, tok);

    this.ranks = new Map();
    json.model.merges.forEach((m, i) => {
      const pair = Array.isArray(m) ? m : m.split(" ");
      this.ranks.set(`${pair[0]} ${pair[1]}`, i);
    });

    this.byteEncoder = bytesToUnicode();
    this.byteDecoder = new Map();
    for (const [b, c] of this.byteEncoder) this.byteDecoder.set(c, b);

    for (const t of json.added_tokens ?? []) {
      if (!this.vocab.has(t.content)) this.vocab.set(t.content, t.id);
      this.inverseVocab.set(t.id, t.content);
    }
    this.vocabSize = this.vocab.size;
  }

  static async load(url: string): Promise<BPETokenizer> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`tokenizer fetch failed: ${res.status}`);
    return new BPETokenizer((await res.json()) as TokenizerJSON);
  }

  /** Standard BPE merge loop over one pre-token, memoised. */
  private bpe(token: string): string[] {
    const hit = this.cache.get(token);
    if (hit) return hit;

    let word = Array.from(token);
    if (word.length === 1) {
      this.cache.set(token, word);
      return word;
    }

    for (;;) {
      // Lowest merge rank wins; ties resolve to the leftmost occurrence.
      let bestRank = Infinity;
      let first = "";
      let second = "";
      for (let i = 0; i < word.length - 1; i++) {
        const rank = this.ranks.get(`${word[i]} ${word[i + 1]}`);
        if (rank !== undefined && rank < bestRank) {
          bestRank = rank;
          first = word[i];
          second = word[i + 1];
        }
      }
      if (bestRank === Infinity) break;

      // Apply that one pair everywhere it occurs, then re-scan. Merging a
      // single pair per pass is what makes the result independent of scan
      // order and keeps us byte-identical to the Python tokenizer.
      const merged: string[] = [];
      let i = 0;
      while (i < word.length) {
        if (i < word.length - 1 && word[i] === first && word[i + 1] === second) {
          merged.push(first + second);
          i += 2;
        } else {
          merged.push(word[i]);
          i++;
        }
      }
      word = merged;
      if (word.length === 1) break;
    }

    this.cache.set(token, word);
    return word;
  }

  encode(text: string): number[] {
    if (!text) return [];
    const ids: number[] = [];
    const matches = text.match(SPLIT_PATTERN);
    if (!matches) return ids;

    for (const piece of matches) {
      // utf-8 bytes -> printable proxy chars -> BPE -> ids
      let mapped = "";
      for (const byte of this.encoder.encode(piece)) {
        mapped += this.byteEncoder.get(byte)!;
      }
      for (const sub of this.bpe(mapped)) {
        const id = this.vocab.get(sub);
        if (id !== undefined) ids.push(id);
      }
    }
    return ids;
  }

  decode(ids: number[]): string {
    let mapped = "";
    for (const id of ids) mapped += this.inverseVocab.get(id) ?? "";
    const bytes = new Uint8Array(
      Array.from(mapped, (c) => this.byteDecoder.get(c) ?? 0),
    );
    return this.decoder.decode(bytes);
  }

  /** Decode a single id - used for rendering candidate chips. */
  decodeToken(id: number): string {
    return this.decode([id]);
  }

  /**
   * True when the token opens a new word. Byte-level BPE encodes a leading
   * space as 'Ġ', so this is how the editor knows whether accepting a
   * suggestion mid-word should complete it or start a new one.
   */
  startsWord(id: number): boolean {
    return (this.inverseVocab.get(id) ?? "").startsWith("Ġ");
  }
}
