"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  Agent,
  PROVIDER_NAME,
  type AgentSettings,
  type AgentStatus,
  type Heard,
  type Provider,
  type TurnMetrics,
  type UiMessage,
} from "@/lib/agent";
import { STT_MODEL } from "@/lib/aai/stt";
import { DEEPGRAM_ENDPOINTING_MS, DEEPGRAM_MODEL } from "@/lib/deepgram/stt";
import { LANGS, LANG_CODES, isLang, type Lang } from "@/lib/languages";

const STATUS_LABEL = {
  idle: "Session ended",
  connecting: "Connecting…",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
} as const;

export function Tutor() {
  const [settings, setSettings] = useState<AgentSettings>({
    native: "en",
    focus: "es",
    biasKeyterms: true,
    singleVoice: false,
    stt: "assemblyai",
    compare: false,
  });
  const [agent] = useState(() => new Agent(settings));
  const state = useSyncExternalStore(agent.subscribe, agent.getState, agent.getState);
  const [draft, setDraft] = useState("");
  const live = state.status !== "idle";

  useEffect(() => () => agent.dispose(), [agent]);

  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [state.messages, state.partial]);

  function update(patch: Partial<AgentSettings>) {
    const next = { ...settings, ...patch };
    // Picking the language that is on the other side swaps the two.
    if (next.native === next.focus) {
      if (patch.native) next.focus = settings.native;
      else next.native = settings.focus;
    }
    setSettings(next);
    if (next.focus !== settings.focus) agent.setFocus(next.focus);
    if (patch.biasKeyterms !== undefined) agent.setBiasKeyterms(patch.biasKeyterms);
  }

  // Before the first session the page is just a small centred card. Starting a
  // session swaps it for the full workspace, which grows into place.
  if (!live && state.messages.length === 0) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-8 p-6">
        <h1 className="text-center text-4xl font-semibold tracking-tight md:text-5xl">
          What do you want to learn to say?
        </h1>
        <div className="w-full max-w-2xl animate-[rise_0.4s_ease-out] rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <p className="pb-8 text-lg text-zinc-500">
            Ask out loud, like “How do I say <i>nice to meet you</i> in{" "}
            {/* Styled like a phrase the tutor teaches, and re-keyed so it pops
                in again each time a different language is picked. */}
            <span
              key={settings.focus}
              className="inline-block animate-[pop_0.4s_cubic-bezier(0.3,1.5,0.5,1)] rounded-lg bg-emerald-500/10 px-2 py-0.5 font-semibold text-emerald-700 dark:text-emerald-300"
            >
              {LANGS[settings.focus].name}
            </span>
            {"?”"}
          </p>
          {/* One row: language pickers on the left, the action on the right.
              On a phone they stack and the button spans the card. */}
          <div className="flex flex-col gap-4 text-sm sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2 whitespace-nowrap text-zinc-500">
              <LangSelect
                value={settings.native}
                onChange={(native) => update({ native })}
              />
              <span aria-hidden>→</span>
              <span className="sr-only">learning</span>
              <LangSelect
                value={settings.focus}
                onChange={(focus) => update({ focus })}
              />
            </div>
            <button
              onClick={() => agent.start(settings)}
              className="shrink-0 rounded-full bg-indigo-600 px-6 py-2.5 font-medium text-white transition hover:bg-indigo-500"
            >
              Start talking
            </button>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-zinc-200 pt-4 text-xs text-zinc-500 dark:border-zinc-800">
            Speech-to-text
            <ProviderSwitch value={settings.stt} onChange={(stt) => update({ stt })} />
            <label className="group ml-auto flex cursor-pointer select-none items-center gap-2.5">
              <span
                className={`transition-colors ${settings.compare ? "text-zinc-800 dark:text-zinc-100" : "group-hover:text-zinc-700 dark:group-hover:text-zinc-300"}`}
              >
                Compare both on the same audio
              </span>
              <input
                type="checkbox"
                className="peer sr-only"
                checked={settings.compare}
                onChange={(event) => update({ compare: event.target.checked })}
              />
              <span className="relative h-5 w-9 shrink-0 rounded-full bg-zinc-300 transition-colors duration-300 peer-checked:bg-indigo-600 peer-focus-visible:ring-2 peer-focus-visible:ring-indigo-400 after:absolute after:left-0.5 after:top-0.5 after:size-4 after:rounded-full after:bg-white after:shadow-sm after:transition-transform after:duration-300 after:ease-[cubic-bezier(0.3,1.3,0.5,1)] peer-checked:after:translate-x-4 dark:bg-zinc-700" />
            </label>
          </div>
        </div>
        {state.error && <p className="max-w-2xl text-sm text-rose-500">{state.error}</p>}
        <p className="text-xs text-zinc-500">
          Built on AssemblyAI speech-to-text, LLM Gateway and text-to-speech.{" "}
          <Link href="/compare" className="underline underline-offset-2 hover:text-zinc-300">
            Compare models
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto grid h-dvh w-full max-w-7xl animate-[grow_0.45s_cubic-bezier(0.2,0.8,0.2,1)] grid-rows-[auto_1fr] gap-4 p-4">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <h1 className="text-lg font-semibold tracking-tight">Language tutor</h1>
          <p className="hidden text-sm text-zinc-500 sm:block">
            {LANGS[settings.native].name} → {LANGS[settings.focus].name}
          </p>
        </div>
        <p className="hidden text-xs text-zinc-500 md:block">
          AssemblyAI speech-to-text · LLM Gateway · text-to-speech
        </p>
      </header>

      <div className="grid min-h-0 gap-5 lg:grid-cols-[1fr_21rem]">
        <section className="flex min-h-0 flex-col overflow-hidden rounded-3xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          {/* The dock: what the agent is doing right now, and the controls. */}
          <div className="border-b border-zinc-200 bg-zinc-50/60 px-5 py-3 dark:border-zinc-800 dark:bg-zinc-950/40">
            <div className="flex items-center gap-4">
              <Orb status={state.status} level={state.micLevel} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{STATUS_LABEL[state.status]}</p>
                <p className="truncate text-xs text-zinc-500">
                  {live
                    ? `${state.micLabel ?? "Microphone"} · ${formatClock(state.audioSentSec)}`
                    : "Your transcript is kept below."}
                </p>
              </div>
              <button
                onClick={() => (live ? agent.stop() : agent.start(settings))}
                disabled={state.status === "connecting"}
                className={`shrink-0 rounded-full px-5 py-2 text-sm font-medium transition disabled:opacity-50 ${
                  live
                    ? "border border-rose-500/40 text-rose-600 hover:bg-rose-500/10 dark:text-rose-400"
                    : "bg-indigo-600 text-white hover:bg-indigo-500"
                }`}
              >
                {live ? "End" : "Start again"}
              </button>
            </div>
          </div>
          <div ref={scroller} className="flex-1 overflow-y-auto px-5 py-5">
            <div className="flex flex-col gap-5">
              {state.messages.map((message) => (
                <Bubble key={message.id} message={message} native={settings.native} />
              ))}
              {state.partial && (
                <div className="ml-auto max-w-[85%] rounded-3xl rounded-br-lg border border-dashed border-indigo-400/50 px-4 py-2.5 text-indigo-700/80 dark:text-indigo-200/70">
                  {state.partial}
                </div>
              )}
            </div>
          </div>

          {state.error && (
            <p className="border-t border-rose-200 bg-rose-50 px-6 py-2 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-300">
              {state.error}
            </p>
          )}

          <form
            className="border-t border-zinc-200 px-5 py-3 dark:border-zinc-800"
            onSubmit={(event) => {
              event.preventDefault();
              agent.sendText(draft);
              setDraft("");
            }}
          >
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              disabled={!live}
              placeholder={live ? "Or type and press Enter" : "Start a session to type"}
              className="block w-full rounded-full border border-zinc-300 bg-white px-4 py-2.5 text-sm outline-none transition focus:border-indigo-500 disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-900"
            />
          </form>
        </section>

        <aside className="flex min-h-0 flex-col gap-4 overflow-y-auto text-sm">
          <Latency metrics={state.metrics} />
          <SideBySide messages={state.messages} />

          <Panel title="Session">
            <Field label="I speak">
              <LangSelect
                align="right"
                value={settings.native}
                disabled={live}
                onChange={(native) => update({ native })}
              />
            </Field>
            <Field label="I'm learning">
              <LangSelect
                align="right"
                value={settings.focus}
                exclude={live ? settings.native : undefined}
                onChange={(focus) => update({ focus })}
              />
            </Field>
            <Field label="Speech-to-text">
              <ProviderSwitch value={settings.stt} disabled={live} onChange={(stt) => update({ stt })} />
            </Field>
            <Toggle
              label="Compare both live"
              hint={`Also sends your audio to ${PROVIDER_NAME[settings.stt === "assemblyai" ? "deepgram" : "assemblyai"]} and shows what it heard. The tutor still acts on ${PROVIDER_NAME[settings.stt]}.`}
              checked={settings.compare}
              disabled={live}
              onChange={(compare) => update({ compare })}
            />
            <Toggle
              label="One voice for every language"
              hint="Off: each language is spoken by a voice recorded in it."
              checked={settings.singleVoice}
              disabled={live}
              onChange={(singleVoice) => update({ singleVoice })}
            />
            <Toggle
              label="Boost taught phrases"
              hint="Tells speech-to-text which phrase to expect. Turn off to hear your mistakes as you said them."
              checked={settings.biasKeyterms}
              onChange={(biasKeyterms) => update({ biasKeyterms })}
            />
          </Panel>

          <Panel title={`${PROVIDER_NAME[settings.stt]}, live`}>
            <Row
              label="Model"
              value={settings.stt === "assemblyai" ? STT_MODEL.replace("assemblyai-", "") : `${DEEPGRAM_MODEL}, multi`}
            />
            <Row label="Languages" value={state.stt.language_codes.join(", ") || "–"} />
            <Row
              label="Turn silence"
              value={
                settings.stt === "deepgram"
                  ? `${DEEPGRAM_ENDPOINTING_MS} ms, fixed`
                  : state.stt.max_turn_silence
                    ? `${state.stt.min_turn_silence}–${state.stt.max_turn_silence} ms`
                    : "–"
              }
            />
            <Row label="LLM" value={state.model ?? "–"} />
            <div>
              <p className="text-zinc-500">Keyterms</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {state.stt.keyterms_prompt.length === 0 && (
                  <span className="text-xs text-zinc-500">none yet</span>
                )}
                {state.stt.keyterms_prompt.map((term) => (
                  <span
                    key={term}
                    className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-700 dark:text-emerald-400"
                  >
                    {term}
                  </span>
                ))}
              </div>
            </div>
          </Panel>

          <Panel title="Compare models">
            <p className="text-zinc-500">
              AssemblyAI and Deepgram on the same test phrases: accuracy, speed, and whether each keeps a learner&apos;s mistake.
            </p>
            <Link
              href="/compare"
              target="_blank"
              className="group flex items-center justify-between rounded-full bg-zinc-900 px-4 py-2 font-medium text-white transition hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
            >
              See the comparison
              <span aria-hidden className="transition-transform group-hover:translate-x-0.5">
                →
              </span>
            </Link>
          </Panel>
        </aside>
      </div>
    </div>
  );
}

function formatClock(seconds: number) {
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/**
 * The agent's state at a glance. While listening the ring swells with the
 * microphone level, so you can see that you are being heard.
 */
function Orb({ status, level }: { status: AgentStatus; level: number }) {
  // Speech sits around 0.02 to 0.2 RMS, so take the square root to make it visible.
  const swell = status === "listening" ? Math.min(1, Math.sqrt(level) * 2.2) : 0;
  const color = {
    idle: "bg-zinc-400",
    connecting: "bg-amber-400",
    listening: "bg-emerald-500",
    thinking: "bg-amber-400",
    speaking: "bg-sky-500",
  }[status];
  return (
    <span className="relative grid size-11 shrink-0 place-items-center">
      <span
        className={`absolute inset-0 rounded-full opacity-25 transition-transform duration-100 ${color} ${
          status === "speaking" || status === "thinking" || status === "connecting"
            ? "animate-ping"
            : ""
        }`}
        style={{ transform: `scale(${0.55 + swell * 0.6})` }}
      />
      <span className={`size-5 rounded-full ${color}`} />
    </span>
  );
}

function Bubble({ message, native }: { message: UiMessage; native: Lang }) {
  if (message.role === "user") {
    const notes = [
      message.ignored && "acknowledgement, didn't interrupt",
      message.lang &&
        isLang(message.lang) &&
        (message.langConfidence ?? 1) >= 0.6 &&
        `heard as ${LANGS[message.lang].name}`,
      !!message.unsure?.length && `unsure of: ${message.unsure.join(", ")}`,
    ].filter(Boolean);
    if (message.otherOnly && message.other) {
      return (
        <div className="ml-auto max-w-[85%] text-right text-xs text-zinc-500">
          Only {PROVIDER_NAME[message.other.provider]} reported a turn here:
          <span className="ml-1 text-zinc-700 dark:text-zinc-300">“{message.other.text}”</span>
        </div>
      );
    }
    return (
      <div className={`ml-auto max-w-[85%] ${message.ignored ? "opacity-50" : ""}`}>
        <div className="ml-auto w-fit rounded-3xl rounded-br-lg bg-indigo-600 px-4 py-2.5 text-white">
          {message.text}
        </div>
        {notes.length > 0 && (
          <p className="mt-1 pr-1 text-right text-xs text-zinc-500">{notes.join(" · ")}</p>
        )}
        {message.heard && message.other && (
          <table className="ml-auto mt-2 text-left text-xs">
            <tbody>
              {[message.heard, message.other].map((heard) => (
                <tr key={heard.provider} className="align-top">
                  <td className="pr-3 text-zinc-500">{PROVIDER_NAME[heard.provider]}</td>
                  <td className="pr-3 text-right tabular-nums text-zinc-500">{ms(heard.latency)}</td>
                  <td
                    className={
                      sameWords(heard.text, message.heard!.text)
                        ? "text-zinc-700 dark:text-zinc-300"
                        : "font-medium text-amber-600 dark:text-amber-400"
                    }
                  >
                    {heard.text}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    );
  }
  return (
    <div className="max-w-[90%]">
      <div className="text-[1.05rem] leading-8">
        {message.segments.length === 0 && (
          <span className="inline-flex gap-1 align-middle">
            {[0, 150, 300].map((delay) => (
              <span
                key={delay}
                className="size-1.5 animate-bounce rounded-full bg-zinc-400"
                style={{ animationDelay: `${delay}ms` }}
              />
            ))}
          </span>
        )}
        {message.segments.map((segment) => {
          const foreign = segment.lang !== native;
          const tone =
            segment.state === "dropped"
              ? "opacity-40 line-through"
              : segment.state === "queued"
                ? "opacity-40"
                : "";
          if (!foreign) {
            return (
              <span
                key={segment.id}
                className={`transition-opacity ${tone} ${
                  segment.state === "speaking" ? "text-sky-600 dark:text-sky-300" : ""
                }`}
              >
                {segment.text}{" "}
              </span>
            );
          }
          // The phrase being taught: the thing the learner came for.
          return (
            <span key={segment.id}>
              <span
                className={`inline-flex items-baseline gap-1.5 rounded-lg px-2 py-0.5 font-semibold transition ${tone} ${
                  segment.state === "speaking"
                    ? "bg-emerald-500 text-white"
                    : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                }`}
              >
                {segment.text}
                <span className="text-[10px] font-medium uppercase tracking-wide opacity-70">
                  {segment.lang}
                </span>
              </span>{" "}
            </span>
          );
        })}
      </div>
      {message.interrupted && <p className="mt-1 text-xs text-zinc-500">interrupted by you</p>}
    </div>
  );
}

function Latency({ metrics }: { metrics: TurnMetrics[] }) {
  const stages = [
    ["endpoint", "Speech → transcript", "includes the turn-detection wait"],
    ["llm", "Transcript → first LLM token", ""],
    ["tts", "Text → first audio", ""],
  ] as const;
  const last = metrics.at(-1);
  const typical = median(metrics.map((m) => m.total));
  return (
    <Panel title="Response time">
      <div className="flex items-end justify-between">
        <p className="text-4xl font-semibold tabular-nums tracking-tight">
          {last?.total === undefined ? "–" : (last.total / 1000).toFixed(2)}
          <span className="ml-1 text-base font-normal text-zinc-500">s</span>
        </p>
        <p className="pb-1 text-right text-xs text-zinc-500">
          median {typical === undefined ? "–" : `${(typical / 1000).toFixed(2)} s`}
          <br />
          over {metrics.length} turn{metrics.length === 1 ? "" : "s"}
        </p>
      </div>
      <p className="text-xs text-zinc-500">
        From the end of your last word to the tutor&apos;s first sound, measured in this browser.
      </p>
      <table className="w-full border-t border-zinc-200 text-left dark:border-zinc-800">
        <thead className="text-xs text-zinc-500">
          <tr>
            <th className="pt-2 font-normal" />
            <th className="w-16 pt-2 text-right font-normal">last</th>
            <th className="w-16 pt-2 text-right font-normal">median</th>
          </tr>
        </thead>
        <tbody>
          {stages.map(([key, label, note]) => (
            <tr key={key}>
              <td className="py-1">
                {label}
                {note && <span className="block text-xs text-zinc-500">{note}</span>}
              </td>
              <td className="text-right align-top tabular-nums">{ms(last?.[key])}</td>
              <td className="text-right align-top tabular-nums text-zinc-500">
                {ms(median(metrics.map((m) => m[key])))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

/** Whether two transcripts are the same words, ignoring case and punctuation. */
function sameWords(a: string, b: string) {
  const plain = (text: string) =>
    text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim();
  return plain(a) === plain(b);
}

/** Running totals for comparison mode: how often the two agreed, and how fast each was. */
function SideBySide({ messages }: { messages: UiMessage[] }) {
  const pairs = messages.flatMap((m) =>
    m.role === "user" && m.heard && m.other ? [[m.heard, m.other] as [Heard, Heard]] : [],
  );
  const alone = messages.filter((m) => m.role === "user" && m.otherOnly).length;
  if (!pairs.length && !alone) return null;
  const agreed = pairs.filter(([a, b]) => sameWords(a.text, b.text)).length;
  const providers = pairs.length ? [pairs[0][0].provider, pairs[0][1].provider] : [];
  return (
    <Panel title="Side by side, same audio">
      <p>
        <span className="text-2xl font-semibold tabular-nums">
          {agreed} of {pairs.length}
        </span>{" "}
        <span className="text-zinc-500">turns transcribed the same</span>
      </p>
      {providers.map((provider) => (
        <Row
          key={provider}
          label={`${PROVIDER_NAME[provider]}, median`}
          value={ms(
            median(
              pairs.map((pair) => pair.find((heard) => heard.provider === provider)?.latency),
            ),
          )}
        />
      ))}
      <p className="text-xs text-zinc-500">
        Time from end of speech to the finished transcript.
        {alone > 0 && ` ${alone} turn${alone === 1 ? " was" : "s were"} reported by one provider only.`}{" "}
        Every turn is saved to eval/results/live.jsonl.
      </p>
    </Panel>
  );
}

function ms(value?: number) {
  return value === undefined ? "–" : `${Math.round(value)} ms`;
}

function median(values: (number | undefined)[]) {
  const sorted = values.filter((v): v is number => v !== undefined).sort((a, b) => a - b);
  if (!sorted.length) return undefined;
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3 rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{title}</h2>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span>{label}</span>
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="shrink-0 text-zinc-500">{label}</span>
      <span className="break-words text-right font-mono text-xs leading-5">{value}</span>
    </div>
  );
}

// The highlight takes on the chosen provider's colour. Deepgram's is the pink
// of the buttons in its console, with a dark label as they have.
const PROVIDER_PILL: Record<Provider, { pill: string; text: string }> = {
  assemblyai: { pill: "bg-indigo-600", text: "text-white" },
  deepgram: { pill: "bg-[#e041fe]", text: "text-zinc-950" },
};

/**
 * Chooses which speech-to-text provider the tutor acts on. The highlight is one
 * element that slides and resizes to sit behind the chosen label.
 */
function ProviderSwitch(props: {
  value: Provider;
  disabled?: boolean;
  onChange: (provider: Provider) => void;
}) {
  const providers = Object.keys(PROVIDER_NAME) as Provider[];
  const buttons = useRef(new Map<Provider, HTMLButtonElement>());
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null);

  // The labels differ in width, so measure the chosen one rather than assume halves.
  useLayoutEffect(() => {
    const button = buttons.current.get(props.value);
    if (button) setPill({ left: button.offsetLeft, width: button.offsetWidth });
  }, [props.value]);

  return (
    <div className="relative flex rounded-full border border-zinc-300 p-0.5 dark:border-zinc-700">
      {pill && (
        <span
          aria-hidden
          className={`absolute inset-y-0.5 left-0 rounded-full shadow-sm transition-[transform,width,background-color] duration-300 ease-[cubic-bezier(0.3,1.3,0.5,1)] ${PROVIDER_PILL[props.value].pill}`}
          style={{ width: pill.width, transform: `translateX(${pill.left}px)` }}
        />
      )}
      {providers.map((provider) => (
        <button
          key={provider}
          ref={(element) => {
            if (element) buttons.current.set(provider, element);
          }}
          type="button"
          disabled={props.disabled}
          aria-pressed={props.value === provider}
          onClick={() => props.onChange(provider)}
          className={`relative rounded-full px-3 py-1 text-xs font-medium transition-colors duration-300 active:scale-95 disabled:cursor-default ${
            props.value === provider
              ? PROVIDER_PILL[provider].text
              : "text-zinc-500 enabled:hover:text-zinc-800 dark:enabled:hover:text-zinc-200"
          } ${props.disabled && props.value !== provider ? "opacity-40" : ""}`}
        >
          {PROVIDER_NAME[provider]}
        </button>
      ))}
    </div>
  );
}

/** Tailwind moves and scales with the `translate` and `scale` properties, so both need the timing. */
function spring(timing: string, rest: string) {
  return `translate ${timing}, scale ${timing}, ${rest}`;
}

/** A language picker: a pill that opens a small menu. Arrow keys, Enter and Escape work. */
function LangSelect(props: {
  value: Lang;
  /** A language to leave out of the list, when it can't be chosen. */
  exclude?: Lang;
  disabled?: boolean;
  /** Which edge of the pill the menu lines up with. */
  align?: "left" | "right";
  onChange: (lang: Lang) => void;
}) {
  const options = LANG_CODES.filter((code) => code !== props.exclude);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);

  // Close when the pointer goes down anywhere outside the picker.
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  function toggle() {
    setActive(Math.max(0, options.indexOf(props.value)));
    setOpen((value) => !value);
  }

  function choose(lang: Lang) {
    props.onChange(lang);
    setOpen(false);
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") return setOpen(false);
    if (!open) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        toggle();
      }
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((index) => (index + step + options.length) % options.length);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      choose(options[active]);
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  }

  return (
    <div ref={root} className="relative" onKeyDown={onKeyDown}>
      <button
        type="button"
        disabled={props.disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={toggle}
        className={`flex items-center gap-2 rounded-full border px-3.5 py-1.5 font-medium text-zinc-800 transition disabled:opacity-50 dark:text-zinc-100 ${
          open
            ? "border-indigo-500 bg-indigo-500/10"
            : "border-zinc-300 hover:border-zinc-400 dark:border-zinc-700 dark:hover:border-zinc-500"
        }`}
      >
        {LANGS[props.value].name}
        <svg
          viewBox="0 0 12 12"
          className={`size-3 text-zinc-500 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M2.5 4.5 6 8l3.5-3.5" />
        </svg>
      </button>
      {/* Always in the page so it can animate out as well as in. While closed it
          is invisible, which also hides it from the keyboard and screen readers. */}
      <ul
          role="listbox"
          aria-hidden={!open}
          className={`absolute top-full z-20 mt-2 min-w-40 rounded-2xl border border-zinc-200 bg-white p-1 shadow-xl dark:border-zinc-700 dark:bg-zinc-900 ${
            props.align === "right" ? "right-0 origin-top-right" : "left-0 origin-top-left"
          } ${
            open
              ? "visible translate-y-0 scale-100 opacity-100"
              : "pointer-events-none invisible -translate-y-5 scale-90 opacity-0"
          }`}
          style={{
            // Opening springs down past its resting place and settles. Closing is
            // the reverse: it dips a little first, then snaps back up into the
            // pill, staying solid until the last moment instead of fading out.
            transition: open
              ? spring("300ms cubic-bezier(0.3, 1.5, 0.5, 1)", "opacity 120ms ease-out, visibility 300ms")
              : spring("260ms cubic-bezier(0.5, -0.6, 0.7, 0)", "opacity 90ms ease-in 170ms, visibility 260ms"),
          }}
        >
          {/* One highlight that slides between rows, like the provider switch. */}
          <span
            aria-hidden
            className="absolute inset-x-1 top-1 h-9 rounded-xl bg-zinc-100 transition-transform duration-200 ease-[cubic-bezier(0.3,1.3,0.5,1)] dark:bg-zinc-800"
            style={{ transform: `translateY(${active * 2.25}rem)` }}
          />
          {options.map((code, index) => (
            <li
              key={code}
              role="option"
              aria-selected={code === props.value}
              onPointerEnter={() => setActive(index)}
              onClick={() => choose(code)}
              className="relative flex h-9 cursor-pointer items-center justify-between gap-6 rounded-xl px-3 text-zinc-800 dark:text-zinc-100"
            >
              {LANGS[code].name}
              {code === props.value && (
                <svg
                  viewBox="0 0 12 12"
                  className="size-3 text-indigo-500"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="m2.5 6.5 2.5 2.5 4.5-5.5" />
                </svg>
              )}
            </li>
          ))}
        </ul>
    </div>
  );
}

function Toggle(props: {
  label: string;
  hint: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label
      className={`flex cursor-pointer items-start justify-between gap-3 ${props.disabled ? "cursor-default opacity-50" : ""}`}
    >
      <span>
        {props.label}
        <span className="block text-xs text-zinc-500">{props.hint}</span>
      </span>
      <input
        type="checkbox"
        className="peer sr-only"
        checked={props.checked}
        disabled={props.disabled}
        onChange={(event) => props.onChange(event.target.checked)}
      />
      <span className="relative mt-0.5 h-5 w-9 shrink-0 rounded-full bg-zinc-300 transition peer-checked:bg-indigo-600 peer-focus-visible:ring-2 peer-focus-visible:ring-indigo-400 after:absolute after:left-0.5 after:top-0.5 after:size-4 after:rounded-full after:bg-white after:transition peer-checked:after:translate-x-4 dark:bg-zinc-700" />
    </label>
  );
}
