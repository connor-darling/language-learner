import { SttClient, type SttLiveConfig, type TurnMessage } from "./aai/stt";
import { TtsSession } from "./aai/tts";
import { DeepgramClient } from "./deepgram/stt";
import { startMic } from "./audio/mic";
import { SegmentPlayer } from "./audio/player";
import { isBackchannel, isInterruption } from "./backchannel";
import { LANGS, type Lang } from "./languages";
import { Segmenter, stripTags, type Segment } from "./segmenter";
import { SILENCE_ATTEMPT, SILENCE_CONVERSATION } from "./stt-config";

export type AgentSettings = {
  native: Lang;
  focus: Lang;
  /** Push each taught phrase to STT as keyterms. README decision 5 covers the risk and the measurement. */
  biasKeyterms: boolean;
  /** Speak every language in the native-language voice instead of a native voice per language. */
  singleVoice: boolean;
  /** Which speech-to-text provider the tutor acts on. */
  stt: Provider;
  /** Also send the same audio to the other provider and show what it heard. */
  compare: boolean;
};

export type Provider = "assemblyai" | "deepgram";
export const PROVIDER_NAME: Record<Provider, string> = {
  assemblyai: "AssemblyAI",
  deepgram: "Deepgram",
};

/** What one provider made of a turn: its transcript, and ms from end of speech to that transcript. */
export type Heard = { provider: Provider; text: string; latency?: number };

type SttLike = Pick<SttClient, "connect" | "sendAudio" | "close" | "audioClockMs"> & {
  update(config: SttLiveConfig): void;
};

export type UiSegment = {
  id: string;
  lang: Lang;
  text: string;
  state: "queued" | "speaking" | "spoken" | "dropped";
};

export type UiMessage =
  | {
      id: string;
      role: "user";
      text: string;
      lang?: string;
      langConfidence?: number;
      unsure?: string[];
      ignored?: boolean;
      /** The provider the tutor acted on for this turn. Absent for typed messages. */
      heard?: Heard;
      /** In comparison mode, what the other provider made of the same audio. */
      other?: Heard;
      /** A turn only the other provider reported; the tutor never saw it. */
      otherOnly?: boolean;
      /** Where the turn's last word ended on the audio clock, for pairing the two providers. */
      endMs?: number;
    }
  | { id: string; role: "assistant"; segments: UiSegment[]; interrupted?: boolean };

/** Where the time went on one turn, all measured in the browser, in ms. */
export type TurnMetrics = {
  id: number;
  /** Learner's last word ended → final transcript arrived. Includes the endpointing wait. */
  endpoint?: number;
  /** Final transcript → first LLM token. */
  llm?: number;
  /** First text sent to TTS → first audio back. */
  tts?: number;
  /** Learner's last word ended → tutor's first audio plays. What the learner feels. */
  total?: number;
};

export type AgentStatus = "idle" | "connecting" | "listening" | "thinking" | "speaking";

export type AgentState = {
  status: AgentStatus;
  messages: UiMessage[];
  partial: string;
  metrics: TurnMetrics[];
  stt: Required<Pick<SttLiveConfig, "language_codes" | "keyterms_prompt">> &
    Pick<SttLiveConfig, "min_turn_silence" | "max_turn_silence">;
  model?: string;
  error?: string;
  /** Microphone loudness, 0 to 1, and how much audio has reached STT. */
  micLevel: number;
  audioSentSec: number;
  micLabel?: string;
};

type Response = {
  id: number;
  abort: AbortController;
  segments: UiSegment[];
  messageId: string;
  llmDone: boolean;
  historyEntry?: { role: "assistant"; content: string };
  finalAt?: number;
  firstSpeakAt?: number;
  gotAudio: boolean;
};

const GREETINGS: Record<Lang, string> = {
  en: "Hi! What would you like to learn to say today?",
  es: "¡Hola! ¿Qué te gustaría aprender a decir hoy?",
  fr: "Bonjour ! Qu'aimeriez-vous apprendre à dire aujourd'hui ?",
  de: "Hallo! Was möchtest du heute sagen lernen?",
  it: "Ciao! Cosa ti piacerebbe imparare a dire oggi?",
  pt: "Olá! O que você gostaria de aprender a dizer hoje?",
};

const LOW_CONFIDENCE = 0.5;

function plainWords(text: string) {
  return text
    .toLowerCase()
    .replace(/\[.*?\]/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export class Agent {
  private state: AgentState = {
    status: "idle",
    messages: [],
    partial: "",
    metrics: [],
    stt: { language_codes: [], keyterms_prompt: [] },
    micLevel: 0,
    audioSentSec: 0,
  };
  private listeners = new Set<() => void>();

  private stt: SttLike | null = null;
  /** The second provider in comparison mode. It hears the same audio but drives nothing. */
  private shadow: SttLike | null = null;
  private unpaired: { heard: Heard; endMs: number }[] = [];
  private mic: { label: string; stop(): void } | null = null;
  private player: SegmentPlayer | null = null;
  private voices = new Map<Lang, TtsSession>();
  private history: { role: "user" | "assistant"; content: string }[] = [];
  private response: Response | null = null;
  private seq = 0;

  constructor(private settings: AgentSettings) {}

  // --- React store plumbing -------------------------------------------------

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getState = () => this.state;

  private set(patch: Partial<AgentState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  // --- Lifecycle --------------------------------------------------------------

  async start(settings: AgentSettings) {
    this.settings = settings;
    this.history = [];
    this.set({ status: "connecting", messages: [], metrics: [], partial: "", error: undefined });
    try {
      this.player = new SegmentPlayer();
      this.player.onSegmentStart = (id) => this.onSegmentStart(id);
      this.player.onIdle = () => this.maybeFinish();
      await this.player.resume();

      const { native, focus } = settings;
      const greeting = GREETINGS[native];
      const sttConfig = {
        language_codes: [...new Set([native, focus])] as string[],
        keyterms_prompt: [] as string[],
        ...SILENCE_CONVERSATION,
      };
      const other: Provider = settings.stt === "assemblyai" ? "deepgram" : "assemblyai";
      const connect = (provider: Provider, driving: boolean): SttLike => {
        const Client = provider === "assemblyai" ? SttClient : DeepgramClient;
        const name = PROVIDER_NAME[provider];
        return new Client({
          ...sttConfig,
          agent_context: greeting,
          onTurn: (turn) => (driving ? this.onTurn(turn) : this.onShadowTurn(provider, turn)),
          onClose: (reason) =>
            driving
              ? this.fail(`${name} connection closed (${reason})`)
              : this.set({ error: `${name} (comparison) disconnected: ${reason}` }),
          onError: (message) => this.set({ error: `${name}: ${message}` }),
        });
      };
      this.stt = connect(settings.stt, true);
      this.shadow = settings.compare ? connect(other, false) : null;
      this.unpaired = [];

      // Open everything in parallel. Holding the TTS sockets open from the
      // start keeps connection setup out of the first reply's latency.
      await Promise.all([
        this.stt.connect(),
        this.shadow?.connect(),
        this.voice(native).open(),
        this.voice(focus).open(),
      ]);
      this.set({ stt: sttConfig });

      let peak = 0;
      let chunks = 0;
      this.mic = await startMic((pcm, level) => {
        // Both providers get the same chunk at the same moment, so their
        // transcripts and timings describe identical audio.
        this.shadow?.sendAudio(pcm.slice(0));
        this.stt?.sendAudio(pcm);
        peak = Math.max(peak, level);
        // Refresh the meter every 100 ms rather than on every chunk.
        if (++chunks % 2 === 0) {
          this.set({ micLevel: peak, audioSentSec: (this.stt?.audioClockMs ?? 0) / 1000 });
          peak = 0;
          if (this.unpaired.length) this.pair();
        }
      });
      this.set({ micLabel: this.mic.label });

      const response = this.beginResponse();
      response.llmDone = true;
      response.historyEntry = { role: "assistant", content: greeting };
      this.history.push(response.historyEntry);
      this.speak(response, { lang: native, text: greeting });
    } catch (error) {
      this.fail(error instanceof Error ? error.message : String(error));
    }
  }

  stop() {
    if (this.response) {
      this.response.abort.abort();
      for (const segment of this.response.segments) {
        segment.state = segment.state === "queued" ? "dropped" : "spoken";
      }
      this.renderSegments(this.response);
    }
    this.response = null;
    this.mic?.stop();
    this.stt?.close();
    this.shadow?.close();
    this.shadow = null;
    // The voice sessions stay open for the next Start. New sessions are capped
    // per minute, so reopening two on every restart runs into the cap quickly.
    for (const voice of this.voices.values()) voice.cancel();
    this.player?.close();
    this.mic = this.stt = this.player = null;
    this.set({ status: "idle", partial: "", micLevel: 0 });
  }

  private fail(message: string) {
    if (this.state.status === "idle") return;
    this.stop();
    this.set({ error: message });
  }

  /** Changes the language being learned without restarting the session. */
  setFocus(focus: Lang) {
    this.settings = { ...this.settings, focus };
    if (!this.stt) return;
    void this.voice(focus).open();
    this.updateStt({ language_codes: [...new Set([this.settings.native, focus])] });
  }

  setBiasKeyterms(biasKeyterms: boolean) {
    this.settings = { ...this.settings, biasKeyterms };
    if (!biasKeyterms && this.stt) this.updateStt({ keyterms_prompt: [] });
  }

  /** Closes everything, including the voice sessions kept open between sessions. */
  dispose() {
    this.stop();
    for (const voice of this.voices.values()) voice.close();
    this.voices.clear();
  }

  private voice(lang: Lang) {
    const voiceId = LANGS[this.settings.singleVoice ? this.settings.native : lang].voice;
    let session = this.voices.get(lang);
    // A session speaks one voice for life; a changed setting needs a new one.
    if (session && session.voiceId !== voiceId) {
      session.close();
      session = undefined;
    }
    if (!session) {
      session = new TtsSession(lang, voiceId, {
        onAudio: (id, pcm) => this.onAudio(id, pcm),
        onSegmentDone: (id) => this.player?.finish(id),
        onError: (message) => this.set({ error: message }),
      });
      this.voices.set(lang, session);
    }
    return session;
  }

  private updateStt(config: SttLiveConfig) {
    this.stt?.update(config);
    this.shadow?.update(config);
    const visible = { ...config };
    delete visible.agent_context;
    this.set({ stt: { ...this.state.stt, ...visible } });
  }

  // --- Listening --------------------------------------------------------------

  private onTurn(turn: TurnMessage) {
    const text = turn.transcript.trim();
    const speaking = this.response !== null;

    if (!turn.end_of_turn) {
      this.set({ partial: text });
      // Barge-in on partials, so the tutor stops as soon as the learner has
      // clearly started saying something, not when they finish.
      if (speaking && isInterruption(text)) this.interrupt();
      return;
    }

    this.set({ partial: "" });
    if (!text) return;

    const lang = turn.language_code;
    const unsure = turn.words
      .filter((word) => word.confidence < LOW_CONFIDENCE)
      .map((word) => word.text.replace(/[.,!?¿¡;:]/g, ""))
      .filter(Boolean);
    // Time from the end of the learner's last word to now, on the audio clock.
    const lastWord = turn.words.at(-1);
    const endpoint =
      lastWord && this.stt ? Math.max(0, this.stt.audioClockMs - lastWord.end) : undefined;
    const message: UiMessage & { role: "user" } = {
      id: `u${++this.seq}`,
      role: "user",
      text,
      lang,
      langConfidence: turn.language_confidence,
      unsure,
      heard: { provider: this.settings.stt, text, latency: endpoint },
      endMs: lastWord?.end,
    };

    if (this.response) {
      if (isBackchannel(text)) {
        // "mhm", "okay" and the like while the tutor talks: show it, don't act on it.
        this.set({ messages: [...this.state.messages, { ...message, ignored: true }] });
        this.pair();
        return;
      }
      // A finished turn that isn't filler interrupts even at one word ("Stop.").
      this.interrupt();
    }

    const notes: string[] = [];
    // The detected language is shown in the UI but not sent to the LLM: on a
    // two-word attempt it is often wrong, and the words speak for themselves.
    if (unsure.length) notes.push(`low-confidence words: ${unsure.join(", ")}`);
    this.userTurn(message, notes, endpoint);
    this.pair();
  }

  // --- Comparison mode ----------------------------------------------------------

  /** A finished turn from the provider that is only listening along. */
  private onShadowTurn(provider: Provider, turn: TurnMessage) {
    const text = turn.transcript.trim();
    const lastWord = turn.words.at(-1);
    if (!turn.end_of_turn || !text || !lastWord || !this.shadow) return;
    this.unpaired.push({
      heard: { provider, text, latency: Math.max(0, this.shadow.audioClockMs - lastWord.end) },
      endMs: lastWord.end,
    });
    this.pair();
  }

  /**
   * Matches what the second provider heard to the turn the tutor acted on.
   * Both report where the last word ended on the same audio clock, so two
   * reports of the same utterance end within a moment of each other. Reports
   * that never find a partner are shown on their own: one provider heard a
   * turn the other did not, which is itself a result.
   */
  private pair() {
    if (!this.shadow) return;
    const WINDOW_MS = 2500;
    const now = this.shadow.audioClockMs;
    const messages = [...this.state.messages];
    const logged: UiMessage[] = [];

    this.unpaired = this.unpaired.filter((candidate) => {
      const index = messages.findLastIndex(
        (m) =>
          m.role === "user" &&
          !m.other &&
          !m.otherOnly &&
          m.endMs !== undefined &&
          Math.abs(m.endMs - candidate.endMs) < WINDOW_MS,
      );
      if (index >= 0) {
        messages[index] = { ...messages[index], other: candidate.heard } as UiMessage;
        logged.push(messages[index]);
        return false;
      }
      if (now - candidate.endMs < WINDOW_MS * 2) return true; // its partner may still arrive
      const alone: UiMessage = {
        id: `u${++this.seq}`,
        role: "user",
        text: candidate.heard.text,
        other: candidate.heard,
        otherOnly: true,
        endMs: candidate.endMs,
      };
      messages.push(alone);
      logged.push(alone);
      return false;
    });

    if (!logged.length) return;
    this.set({ messages });
    for (const message of logged) {
      if (message.role !== "user") continue;
      void fetch("/api/compare-log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          languages: this.state.stt.language_codes,
          acted_on: message.heard ?? null,
          other: message.other ?? null,
        }),
      }).catch(() => {});
    }
  }

  /** Lets a typed message stand in for a spoken turn (useful without a mic). */
  sendText(text: string) {
    if (!this.stt || !text.trim()) return;
    if (this.response) this.interrupt();
    this.userTurn({ id: `u${++this.seq}`, role: "user", text: text.trim() }, []);
  }

  private userTurn(message: UiMessage & { role: "user" }, notes: string[], endpoint?: number) {
    this.set({ messages: [...this.state.messages, message] });
    const note = notes.length ? ` [${notes.join("; ")}]` : "";
    const last = this.history.at(-1);
    // If the learner kept talking before the tutor said anything, fold the
    // turns together rather than sending two user messages in a row.
    if (last?.role === "user") last.content += ` ${message.text}${note}`;
    else this.history.push({ role: "user", content: message.text + note });
    void this.respond(endpoint);
  }

  // --- Thinking and speaking ----------------------------------------------------

  private beginResponse(): Response {
    const id = ++this.seq;
    const response: Response = {
      id,
      abort: new AbortController(),
      segments: [],
      messageId: `a${id}`,
      llmDone: false,
      gotAudio: false,
    };
    this.response = response;
    this.set({
      status: "thinking",
      messages: [...this.state.messages, { id: response.messageId, role: "assistant", segments: [] }],
    });
    return response;
  }

  private async respond(endpoint?: number) {
    const response = this.beginResponse();
    response.finalAt = performance.now();
    this.metric(response.id, { endpoint });

    const segmenter = new Segmenter(this.settings.native, (segment) =>
      this.speak(response, segment),
    );
    let raw = "";
    try {
      const reply = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: this.history,
          native: this.settings.native,
          focus: this.settings.focus,
        }),
        signal: response.abort.signal,
      });
      if (!reply.ok || !reply.body) {
        const detail = await reply.json().catch(() => ({}));
        throw new Error(detail.error ?? `chat request failed (${reply.status})`);
      }
      this.set({ model: reply.headers.get("X-LLM-Model") ?? undefined });

      const reader = reply.body.pipeThrough(new TextDecoderStream()).getReader();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!raw) this.metric(response.id, { llm: performance.now() - response.finalAt });
        raw += value;
        segmenter.push(value);
      }
      segmenter.end();
    } catch (error) {
      if (response.abort.signal.aborted) return; // barge-in, already handled
      this.set({ error: error instanceof Error ? error.message : String(error) });
    }
    if (this.response !== response) return;

    response.llmDone = true;
    if (raw.trim()) {
      response.historyEntry = { role: "assistant", content: raw.trim() };
      this.history.push(response.historyEntry);
    }
    this.afterReply(response, raw);
    this.maybeFinish();
  }

  private speak(response: Response, segment: Segment) {
    if (this.response !== response || !this.player) return;
    const ui: UiSegment = {
      id: `${response.id}:${response.segments.length}`,
      lang: segment.lang,
      text: segment.text,
      state: "queued",
    };
    response.segments.push(ui);
    this.renderSegments(response);

    // The tutor has moved to a language STT is not yet steered toward (the
    // learner asked for a different one). Add it so their attempt is recognised.
    if (!this.state.stt.language_codes.includes(segment.lang)) {
      this.updateStt({ language_codes: [...this.state.stt.language_codes, segment.lang] });
    }

    response.firstSpeakAt ??= performance.now();
    this.player.enqueue(ui.id);
    void this.voice(segment.lang).speak(ui.id, segment.text);
  }

  private onAudio(segmentId: string, pcm: Int16Array) {
    const response = this.response;
    const startsIn = this.player?.push(segmentId, pcm);
    if (!response || startsIn == null || response.gotAudio) return;
    if (!segmentId.startsWith(`${response.id}:`)) return;
    response.gotAudio = true;
    if (response.finalAt === undefined) return; // the greeting isn't a reply to anything
    const now = performance.now();
    const metric = this.state.metrics.find((m) => m.id === response.id);
    this.metric(response.id, {
      tts: now - response.firstSpeakAt!,
      total:
        metric?.endpoint !== undefined
          ? metric.endpoint + (now + startsIn - response.finalAt)
          : undefined,
    });
  }

  private onSegmentStart(segmentId: string) {
    const response = this.response;
    if (!response) return;
    for (const segment of response.segments) {
      if (segment.id === segmentId) segment.state = "speaking";
      else if (segment.state === "speaking") segment.state = "spoken";
    }
    this.renderSegments(response);
    this.set({ status: "speaking" });
  }

  /** After the full reply is written: tell STT what the learner is about to respond to. */
  private afterReply(response: Response, raw: string) {
    // Foreign phrases in the reply, minus any the tutor is quoting back from
    // the learner ("I heard me llama, but..."): boosting the learner's own
    // mistake would teach the recogniser to hear it again.
    const lastUser = this.history.findLast((entry) => entry.role === "user")?.content ?? "";
    const said = ` ${plainWords(lastUser)} `;
    const taught = response.segments
      .filter((segment) => segment.lang !== this.settings.native)
      .map((segment) => segment.text.replace(/[.,!?¿¡;:]/g, "").trim())
      .filter((phrase) => !said.includes(` ${plainWords(phrase)} `))
      // Single short words make poor keyterms and can cause overcorrection.
      .filter((phrase) => phrase.split(/\s+/).length >= 2 || phrase.length >= 6);

    const config: SttLiveConfig = {
      // The tutor's side of the conversation, so STT knows what was just asked.
      // With boosting off, the taught phrase is left out of this too: telling
      // the recogniser the expected answer in any form makes it more likely to
      // hear that answer, even when the learner said something else.
      agent_context: (this.settings.biasKeyterms
        ? stripTags(raw)
        : response.segments
            .filter((segment) => segment.lang === this.settings.native)
            .map((segment) => segment.text)
            .join(" ")
      ).slice(-1500),
      ...(taught.length ? SILENCE_ATTEMPT : SILENCE_CONVERSATION),
    };
    if (this.settings.biasKeyterms) {
      config.keyterms_prompt = [...new Set(taught)].filter((t) => t.length <= 50).slice(0, 100);
    }
    this.updateStt(config);
  }

  private maybeFinish() {
    const response = this.response;
    if (!response || !response.llmDone || this.player?.busy) return;
    for (const segment of response.segments) segment.state = "spoken";
    this.renderSegments(response);
    this.response = null;
    this.set({ status: "listening" });
  }

  /** Barge-in: stop generating, stop synthesizing, stop playing. */
  private interrupt() {
    const response = this.response;
    if (!response) return;
    this.response = null;
    response.abort.abort();
    for (const voice of this.voices.values()) voice.cancel();
    this.player?.stop();

    // The learner only heard part of the reply. Keep just that part in the
    // conversation history, so the LLM doesn't assume they heard the rest.
    const heard = response.segments.filter((s) => s.state === "speaking" || s.state === "spoken");
    for (const segment of response.segments) {
      segment.state = heard.includes(segment) ? "spoken" : "dropped";
    }
    const content = heard
      .map((s) => (s.lang === this.settings.native ? s.text : `<${s.lang}>${s.text}</${s.lang}>`))
      .join(" ");
    if (response.historyEntry) {
      if (content) response.historyEntry.content = `${content} [interrupted by the learner]`;
      else this.history = this.history.filter((entry) => entry !== response.historyEntry);
    } else if (content) {
      this.history.push({ role: "assistant", content: `${content} [interrupted by the learner]` });
    }

    this.renderSegments(response, true);
    this.set({ status: "listening" });
  }

  // --- State helpers ------------------------------------------------------------

  private renderSegments(response: Response, interrupted = false) {
    this.set({
      messages: this.state.messages.map((message) =>
        message.id === response.messageId
          ? {
              id: message.id,
              role: "assistant" as const,
              segments: response.segments.map((s) => ({ ...s })),
              interrupted,
            }
          : message,
      ),
    });
  }

  private metric(id: number, patch: Partial<TurnMetrics>) {
    const existing = this.state.metrics.find((m) => m.id === id);
    this.set({
      metrics: existing
        ? this.state.metrics.map((m) => (m === existing ? { ...m, ...patch } : m))
        : [...this.state.metrics, { id, ...patch }],
    });
  }
}
