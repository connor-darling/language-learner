import Link from "next/link";
import type { Metadata } from "next";
import { reference, type Item, type Kind } from "@/eval/dataset";
import { containsPhrase, normalize, percentile, wer } from "@/eval/metrics";
// The last run of `pnpm eval`. It is committed so this page works on a fresh clone.
import latest from "@/eval/results/latest.json";

export const metadata: Metadata = { title: "Compare models · Language tutor" };

type Result = {
  variant: string;
  item: Item;
  hypothesis: string;
  finals: number;
  latency?: number;
  lang?: string;
  error?: string;
};

const RESULTS = (latest as Result[]).filter((result) => !result.error);

// The two providers keep the same colour everywhere on this page. Blue and
// orange are the first two slots of a palette checked for colour-blind
// separation in both themes; the names are always printed beside the colour.
const PROVIDERS = [
  { id: "assemblyai", name: "AssemblyAI", bar: "bg-[#2a78d6] dark:bg-[#3987e5]" },
  { id: "deepgram", name: "Deepgram", bar: "bg-[#eb6834] dark:bg-[#d95926]" },
] as const;

function of(variant: string, ...kinds: Kind[]) {
  return RESULTS.filter(
    (r) => r.variant === variant && (!kinds.length || kinds.includes(r.item.kind)),
  );
}

/** Word error rate as a percentage across a set of results. */
function werPct(results: Result[]) {
  let errors = 0;
  let words = 0;
  for (const r of results) {
    const score = wer(reference(r.item), r.hypothesis);
    errors += score.errors;
    words += score.words;
  }
  return words ? (100 * errors) / words : 0;
}

function nearMiss(variant: string) {
  const rows = of(variant, "near_miss");
  const kept = rows.filter((r) => containsPhrase(r.hypothesis, reference(r.item))).length;
  const corrected = rows.filter(
    (r) =>
      !containsPhrase(r.hypothesis, reference(r.item)) &&
      containsPhrase(r.hypothesis, r.item.taught ?? ""),
  ).length;
  return { total: rows.length, kept, corrected, other: rows.length - kept - corrected };
}

function latencies(variant: string) {
  return of(variant).flatMap((r) => (r.finals === 1 && r.latency !== undefined ? [r.latency] : []));
}

const sameWords = (a: string, b: string) => normalize(a).join(" ") === normalize(b).join(" ");

export default function ComparePage() {
  const utterances = new Set(RESULTS.map((r) => r.item.id)).size;

  const accuracy = [
    { label: "English questions", note: "“How do you say good morning in Spanish?”", kinds: ["ask"] },
    { label: "Foreign-language attempts", note: "“Buenos días.” Short, no context.", kinds: ["attempt"] },
    { label: "Mixed-language sentences", note: "“Is it bonjour or bonsoir in the evening?”", kinds: ["mixed"] },
  ] as { label: string; note: string; kinds: Kind[] }[];

  const speed = [
    { label: "Median", note: "half of turns were faster than this", p: 50 },
    { label: "90th percentile", note: "the slow end: one turn in ten was slower", p: 90 },
  ];

  const transcripts = [...new Map(RESULTS.map((r) => [r.item.id, r.item])).values()];

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-4 py-8 md:py-12">
      <header className="flex flex-col gap-4">
        <Link href="/" className="w-fit text-sm text-zinc-500 transition hover:text-zinc-800 dark:hover:text-zinc-200">
          ← Back to the tutor
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">
          AssemblyAI and Deepgram on the same audio
        </h1>
        <p className="max-w-2xl text-zinc-600 dark:text-zinc-400">
          {utterances} things a language learner says were streamed through both speech-to-text
          providers in real time, as a microphone would. This is what each one heard and how
          quickly.
        </p>
        <Legend />
      </header>

      <Card
        title="How many words each got wrong"
        hint="Word error rate. Shorter bars are better."
      >
        {accuracy.map((row) => (
          <Group key={row.label} label={row.label} note={row.note}>
            {PROVIDERS.map((provider) => {
              const value = werPct(of(provider.id, ...row.kinds));
              return (
                <Bar
                  key={provider.id}
                  provider={provider}
                  share={value / 60}
                  text={`${value.toFixed(1)}%`}
                  detail={`${provider.name}, ${row.label.toLowerCase()}: ${value.toFixed(1)}% of words wrong`}
                />
              );
            })}
          </Group>
        ))}
      </Card>

      <Card
        title="How long until the transcript was ready"
        hint="From the end of speech to the finished transcript, including each provider's wait to be sure the speaker had stopped. Shorter bars are better."
      >
        {speed.map((row) => (
          <Group key={row.label} label={row.label} note={row.note}>
            {PROVIDERS.map((provider) => {
              const value = percentile(latencies(provider.id), row.p) ?? 0;
              return (
                <Bar
                  key={provider.id}
                  provider={provider}
                  share={value / 1600}
                  text={`${(value / 1000).toFixed(2)} s`}
                  detail={`${provider.name}, ${row.label.toLowerCase()}: ${Math.round(value)} ms`}
                />
              );
            })}
          </Group>
        ))}
      </Card>

      <Card
        title="Did the transcript keep the learner's mistake?"
        hint="Six attempts contain a real learner error, such as “Je suis faim” for “J'ai faim”. A tutor can only correct what the transcript faithfully reports. “+ keyterms” means the correct phrase was boosted, as the tutor does after teaching it."
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[32rem] text-left text-sm">
            <thead className="text-xs text-zinc-500">
              <tr>
                <th className="py-2 font-normal" />
                <th className="py-2 font-normal">Kept the mistake</th>
                <th className="py-2 font-normal">Wrote the correct phrase instead</th>
                <th className="py-2 font-normal">Wrote something else</th>
              </tr>
            </thead>
            <tbody>
              {PROVIDERS.flatMap((provider) =>
                [provider.id, `${provider.id}+keyterms`].map((variant) => {
                  const row = nearMiss(variant);
                  return (
                    <tr key={variant} className="border-t border-zinc-200 dark:border-zinc-800">
                      <td className="py-2.5 pr-4">
                        <span className="flex items-center gap-2">
                          <span className={`size-2.5 rounded-full ${provider.bar}`} />
                          {provider.name}
                          {variant.includes("+") && <span className="text-zinc-500">+ keyterms</span>}
                        </span>
                      </td>
                      <td className="py-2.5 text-base font-semibold tabular-nums">
                        {row.kept} <span className="text-sm font-normal text-zinc-500">of {row.total}</span>
                      </td>
                      <td className="py-2.5 tabular-nums">{row.corrected}</td>
                      <td className="py-2.5 tabular-nums">{row.other}</td>
                    </tr>
                  );
                }),
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Card
        title="Every transcript"
        hint="What was said, and what each provider wrote. Amber marks a transcript whose words differ from what was said."
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <thead className="text-xs text-zinc-500">
              <tr>
                <th className="py-2 pr-4 font-normal">Said</th>
                {PROVIDERS.map((provider) => (
                  <th key={provider.id} className="py-2 pr-4 font-normal">
                    <span className="flex items-center gap-2">
                      <span className={`size-2.5 rounded-full ${provider.bar}`} />
                      {provider.name} heard
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {transcripts.map((item) => (
                <tr key={item.id} className="border-t border-zinc-200 align-top dark:border-zinc-800">
                  <td className="py-2.5 pr-4">
                    {reference(item)}
                    <span className="block text-xs text-zinc-500">{KIND_LABEL[item.kind]}</span>
                  </td>
                  {PROVIDERS.map((provider) => {
                    const heard = RESULTS.find(
                      (r) => r.variant === provider.id && r.item.id === item.id,
                    )?.hypothesis;
                    const right = heard !== undefined && sameWords(heard, reference(item));
                    return (
                      <td
                        key={provider.id}
                        className={`py-2.5 pr-4 ${right ? "" : "font-medium text-amber-700 dark:text-amber-400"}`}
                      >
                        {heard || "(nothing)"}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </main>
  );
}

const KIND_LABEL: Record<Kind, string> = {
  ask: "English question",
  attempt: "Foreign-language attempt",
  mixed: "Mixed-language sentence",
  near_miss: "Attempt with a learner's mistake",
};

function Legend() {
  return (
    <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
      {PROVIDERS.map((provider) => (
        <li key={provider.id} className="flex items-center gap-2">
          <span className={`size-3 rounded-full ${provider.bar}`} />
          {provider.name}
        </li>
      ))}
    </ul>
  );
}

function Card(props: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-5 rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm md:p-7 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold tracking-tight">{props.title}</h2>
        <p className="max-w-2xl text-sm text-zinc-500">{props.hint}</p>
      </div>
      {props.children}
    </section>
  );
}

function Group(props: { label: string; note: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-x-6 gap-y-2 md:grid-cols-[15rem_1fr]">
      <div>
        <p className="text-sm font-medium">{props.label}</p>
        <p className="text-xs text-zinc-500">{props.note}</p>
      </div>
      <div className="flex flex-col gap-0.5">{props.children}</div>
    </div>
  );
}

/** One provider's bar. Every bar in a card shares one scale, so lengths compare directly. */
function Bar(props: {
  provider: (typeof PROVIDERS)[number];
  share: number;
  text: string;
  detail: string;
}) {
  const width = Math.max(0, Math.min(1, props.share)) * 100;
  return (
    <div
      className="group flex items-center gap-3 rounded-md py-1 transition hover:bg-zinc-100 dark:hover:bg-zinc-800/60"
      title={props.detail}
    >
      <span className="w-20 shrink-0 text-xs text-zinc-500">{props.provider.name}</span>
      <div className="flex flex-1 items-center gap-2">
        {/* A zero still gets a sliver, so "no errors" reads as a result, not a missing bar. */}
        <span
          className={`h-2.5 min-w-1 rounded-r-[4px] ${props.provider.bar}`}
          style={{ width: `${width}%` }}
        />
        <span className="shrink-0 text-sm font-medium tabular-nums">{props.text}</span>
      </div>
    </div>
  );
}
