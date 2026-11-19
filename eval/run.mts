// Streams every evaluation utterance through each provider in real time, as a
// microphone would, and reports accuracy, turn detection and latency.
//
//   pnpm eval            run everything
//   pnpm eval ask mixed  run only some kinds

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { LANGS } from "../lib/languages";
import { SILENCE_ATTEMPT, SILENCE_CONVERSATION, STT_SAMPLE_RATE } from "../lib/stt-config";
import { DATASET, reference, type Item, type Kind } from "./dataset";
import { containsPhrase, percentile, wer } from "./metrics";
import { assemblyai, deepgram, type Final, type Provider } from "./providers";

process.loadEnvFile(".env");

const AUDIO_DIR = path.join(import.meta.dirname, "audio");
const RESULTS_DIR = path.join(import.meta.dirname, "results");
const CHUNK_MS = 50;
const CHUNK_BYTES = (STT_SAMPLE_RATE * 2 * CHUNK_MS) / 1000;
const LEAD_IN_MS = 300;
const GIVE_UP_MS = 6000; // how long after speech ends to wait for a final
const SETTLE_MS = 1500; // after a final, how long to watch for another one
const CONCURRENCY = 4;

type Variant = { name: string; provider: Provider; keyterms: boolean };

type Result = {
  variant: string;
  item: Item;
  hypothesis: string;
  finals: number;
  /** End of speech → last final transcript, ms. Undefined if no final came. */
  latency?: number;
  lang?: string;
  error?: string;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function loadPcm(item: Item) {
  const file = await readFile(path.join(AUDIO_DIR, `${item.id}.wav`));
  const data = file.indexOf("data", 12, "ascii");
  if (data < 0) throw new Error(`${item.id}.wav has no data chunk`);
  return file.subarray(data + 8, data + 8 + file.readUInt32LE(data + 4));
}

async function runItem(variant: Variant, item: Item): Promise<Result> {
  const result: Result = { variant: variant.name, item, hypothesis: "", finals: 0 };
  try {
    const pcm = await loadPcm(item);
    const finals: Final[] = [];
    const session = await variant.provider.open({
      languages: [...new Set(["en" as const, item.target])],
      keyterms: variant.keyterms && item.taught ? [item.taught] : [],
      // Same rule as the app: wait longer when the learner is attempting a phrase.
      silence: item.taught ? SILENCE_ATTEMPT : SILENCE_CONVERSATION,
      onFinal: (final) => finals.push(final),
    });

    const silence = Buffer.alloc(CHUNK_BYTES);
    const started = performance.now();
    let sent = 0;
    // Pace against the clock rather than sleeping a fixed 50 ms, so timer
    // jitter doesn't make the stream run slower than real time.
    const pace = async (chunk: Buffer) => {
      session.send(chunk);
      sent++;
      await sleep(Math.max(0, started + sent * CHUNK_MS - performance.now()));
    };

    for (let ms = 0; ms < LEAD_IN_MS; ms += CHUNK_MS) await pace(silence);
    for (let offset = 0; offset < pcm.length; offset += CHUNK_BYTES) {
      const chunk = pcm.subarray(offset, offset + CHUNK_BYTES);
      await pace(chunk.length === CHUNK_BYTES ? chunk : Buffer.concat([chunk, silence]).subarray(0, CHUNK_BYTES));
    }
    const speechEnd = performance.now();

    // Keep the line open with silence, as a live microphone would.
    for (;;) {
      const now = performance.now();
      const last = finals.at(-1);
      if (last && now - Math.max(last.at, speechEnd) > SETTLE_MS) break;
      if (!last && now - speechEnd > GIVE_UP_MS) break;
      await pace(silence);
    }
    session.close();

    result.finals = finals.length;
    result.hypothesis = finals.map((final) => final.text).join(" ");
    result.lang = finals.at(-1)?.lang?.slice(0, 2);
    if (finals.length) result.latency = finals.at(-1)!.at - speechEnd;
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
  }
  return result;
}

async function pool<T, R>(items: T[], worker: (item: T) => Promise<R>) {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await worker(items[index]);
      }
    }),
  );
  return results;
}

// --- Reporting ---------------------------------------------------------------

const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : "–");
const msText = (value?: number) => (value === undefined ? "–" : `${Math.round(value)} ms`);

function werOf(results: Result[]) {
  let errors = 0;
  let words = 0;
  for (const r of results) {
    const score = wer(reference(r.item), r.hypothesis);
    errors += score.errors;
    words += score.words;
  }
  return words ? `${((100 * errors) / words).toFixed(1)}%` : "–";
}

/** Share of target-language phrases inside native-language sentences that came through intact. */
function foreignRecall(results: Result[]) {
  let hit = 0;
  let total = 0;
  for (const r of results) {
    for (const piece of r.item.say) {
      if (piece.lang === "en") continue;
      total++;
      if (containsPhrase(r.hypothesis, piece.text)) hit++;
    }
  }
  return pct(hit, total);
}

function report(variants: Variant[], results: Result[]) {
  const of = (variant: Variant, ...kinds: Kind[]) =>
    results.filter(
      (r) => r.variant === variant.name && !r.error && (!kinds.length || kinds.includes(r.item.kind)),
    );
  const lines: string[] = [];
  const table = (head: string[], rows: string[][]) => {
    lines.push(`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`);
    for (const row of rows) lines.push(`| ${row.join(" | ")} |`);
    lines.push("");
  };

  lines.push("# Evaluation results", "");
  lines.push(
    `${DATASET.length} utterances, streamed in real time at ${CHUNK_MS} ms per chunk. ` +
      "Audio is synthetic and was generated with AssemblyAI's own TTS (see `eval/synthesize.mts`), " +
      "so treat this as a harness check, not a verdict.",
    "",
  );

  lines.push("## Accuracy", "");
  lines.push(
    "Word error rate by kind of utterance (lower is better), and how often a target-language " +
      "phrase spoken inside an English sentence was transcribed intact.",
    "",
  );
  const base = variants.filter((v) => !v.keyterms);
  table(
    ["Provider", "WER: ask", "WER: attempt", "WER: mixed", "Mixed phrases intact", "Language identified"],
    base.map((v) => {
      const single = of(v, "ask", "attempt");
      const right = single.filter((r) => r.lang === r.item.say[0].lang).length;
      return [
        v.name,
        werOf(of(v, "ask")),
        werOf(of(v, "attempt")),
        werOf(of(v, "mixed")),
        foreignRecall(of(v, "mixed")),
        pct(right, single.length),
      ];
    }),
  );

  lines.push("## Does the transcript keep the learner's mistake?", "");
  lines.push(
    "Each near-miss utterance contains a real learner error. A tutor can only correct it if the " +
      "transcript says what was actually said. \"Silently corrected\" means the model wrote the phrase " +
      "the tutor had taught instead, which would earn the learner false praise. The `+keyterms` rows " +
      "boost the taught phrase: that should help recognise a correct attempt (last column), and the " +
      "question is whether it also hides mistakes.",
    "",
  );
  table(
    ["Provider", "Kept the mistake", "Silently corrected", "Something else", "WER: correct attempts"],
    variants.map((v) => {
      const misses = of(v, "near_miss");
      const kept = misses.filter((r) => containsPhrase(r.hypothesis, reference(r.item))).length;
      const fixed = misses.filter(
        (r) => !containsPhrase(r.hypothesis, reference(r.item)) && containsPhrase(r.hypothesis, r.item.taught!),
      ).length;
      return [
        v.name,
        `${kept}/${misses.length}`,
        `${fixed}/${misses.length}`,
        `${misses.length - kept - fixed}/${misses.length}`,
        werOf(of(v, "attempt")),
      ];
    }),
  );

  lines.push("## Turn detection and latency", "");
  lines.push(
    "Every utterance is one turn. More than one final means the provider cut the learner off " +
      "mid-utterance; none means it never decided they had finished. Latency is from the end of " +
      "speech to the complete transcript, which includes each provider's endpointing wait: it is " +
      "the delay a voice agent actually experiences before it can respond.",
    "",
  );
  table(
    ["Provider", "Exactly one turn", "Split", "Missed", "Latency p50", "Latency p90"],
    base.map((v) => {
      const all = of(v);
      const latencies = all.flatMap((r) => (r.finals === 1 && r.latency !== undefined ? [r.latency] : []));
      return [
        v.name,
        pct(all.filter((r) => r.finals === 1).length, all.length),
        String(all.filter((r) => r.finals > 1).length),
        String(all.filter((r) => r.finals === 0).length),
        msText(percentile(latencies, 50)),
        msText(percentile(latencies, 90)),
      ];
    }),
  );

  lines.push("## Every transcript", "");
  table(
    ["Utterance", "Said", ...variants.map((v) => v.name)],
    DATASET.map((item) => [
      item.id,
      reference(item),
      ...variants.map((v) => {
        const r = results.find((x) => x.variant === v.name && x.item.id === item.id);
        if (!r) return "";
        if (r.error) return `error: ${r.error}`;
        return `${r.hypothesis || "(nothing)"}${r.finals > 1 ? ` [${r.finals} turns]` : ""}`;
      }),
    ]),
  );
  return lines.join("\n");
}

// --- Main --------------------------------------------------------------------

const args = process.argv.slice(2);
const reportOnly = args.includes("--report"); // rebuild the report from the last run
const kinds = args.filter((arg) => !arg.startsWith("--")) as Kind[];
const items = DATASET.filter((item) => !kinds.length || kinds.includes(item.kind));
const missing = items.filter((item) => !existsSync(path.join(AUDIO_DIR, `${item.id}.wav`)));
if (missing.length && !reportOnly) {
  console.error(`Missing audio for ${missing.length} utterances. Run \`pnpm eval:synth\` first.`);
  process.exit(1);
}

const variants: Variant[] = [assemblyai, deepgram]
  .filter((provider) => {
    if (!provider.available()) console.warn(`Skipping ${provider.name}: no API key in .env`);
    return provider.available();
  })
  .flatMap((provider) => [
    { name: provider.name, provider, keyterms: false },
    { name: `${provider.name}+keyterms`, provider, keyterms: true },
  ]);

const results: Result[] = reportOnly
  ? JSON.parse(await readFile(path.join(RESULTS_DIR, "latest.json"), "utf8"))
  : [];
for (const variant of reportOnly ? [] : variants) {
  // Boosting a phrase only makes sense where one has just been taught.
  const todo = variant.keyterms ? items.filter((item) => item.taught) : items;
  console.log(`${variant.name}: ${todo.length} utterances (${LANGS.en.name} + target language)`);
  results.push(...(await pool(todo, (item) => runItem(variant, item))));
}

await mkdir(RESULTS_DIR, { recursive: true });
const markdown = report(variants, results);
await writeFile(path.join(RESULTS_DIR, "latest.md"), markdown);
await writeFile(path.join(RESULTS_DIR, "latest.json"), JSON.stringify(results, null, 2));
console.log(`\n${markdown}`);
