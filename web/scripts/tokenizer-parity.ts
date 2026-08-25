/**
 * Tokenizer parity harness.
 *
 * The browser tokenizer is a reimplementation of the Python one the model was
 * trained with. If they disagree on even one merge, the model is fed token ids
 * it never saw in training and the predictions quietly degrade -- with no
 * error anywhere. So: encode the same corpus in both and diff the ids.
 *
 * Run:  node --experimental-strip-types scripts/tokenizer-parity.ts <cases.json>
 */

import { readFileSync } from "node:fs";

import { BPETokenizer, type TokenizerJSON } from "../src/lib/engine/tokenizer.ts";

const tokenizerPath = "public/model/tokenizer.json";
const casesPath = process.argv[2];

const tok = new BPETokenizer(
  JSON.parse(readFileSync(tokenizerPath, "utf8")) as TokenizerJSON,
);

const cases = JSON.parse(readFileSync(casesPath, "utf8")) as {
  text: string;
  ids: number[];
}[];

let failures = 0;
let totalTokens = 0;

for (const c of cases) {
  const got = tok.encode(c.text);
  totalTokens += c.ids.length;

  const same =
    got.length === c.ids.length && got.every((v, i) => v === c.ids[i]);

  if (!same) {
    failures++;
    if (failures <= 5) {
      console.log(`\nMISMATCH: ${JSON.stringify(c.text.slice(0, 70))}`);
      console.log(`  python (${c.ids.length}): ${c.ids.slice(0, 24).join(",")}`);
      console.log(`  ts     (${got.length}): ${got.slice(0, 24).join(",")}`);
      const at = got.findIndex((v, i) => v !== c.ids[i]);
      if (at >= 0) {
        console.log(
          `  first divergence at index ${at}: ` +
            `python=${c.ids[at]} ${JSON.stringify(tok.decodeToken(c.ids[at]))} ` +
            `ts=${got[at]} ${JSON.stringify(tok.decodeToken(got[at]))}`,
        );
      }
    }
  }

  // Round-trip: decoding our own ids must reproduce the input exactly.
  const round = tok.decode(got);
  if (round !== c.text) {
    console.log(`\nROUND-TRIP FAIL: ${JSON.stringify(c.text.slice(0, 60))}`);
    console.log(`  got back:      ${JSON.stringify(round.slice(0, 60))}`);
    failures++;
  }
}

console.log(
  `\n${cases.length - failures}/${cases.length} cases match ` +
    `(${totalTokens.toLocaleString()} tokens compared)`,
);
process.exit(failures ? 1 : 0);
