import type { SttOptions, SttWord, TurnMessage } from "../aai/stt";
import { fetchDeepgramRelay } from "../aai/token";
import { STT_SAMPLE_RATE } from "../stt-config";

// Deepgram's documented setup for multilingual code-switching: Nova-3 with
// language=multi. Endpointing is a plain silence timer; 300 ms is the low end
// of what Deepgram suggests for conversation. A customer comparison should use
// whatever values they run in production.
export const DEEPGRAM_MODEL = "nova-3";
export const DEEPGRAM_ENDPOINTING_MS = 300;

type DeepgramWord = {
  word: string;
  punctuated_word?: string;
  start: number;
  end: number;
  confidence: number;
};

/**
 * Browser client for Deepgram streaming speech-to-text, shaped like the
 * AssemblyAI client so the agent can run on either, or on both at once.
 *
 * Deepgram reports a turn in pieces: `is_final` marks a stretch of audio whose
 * text will not change, and `speech_final` marks the pause that ends the turn.
 * This client joins the pieces and emits one final turn, as AssemblyAI does.
 */
export class DeepgramClient {
  private ws: WebSocket | null = null;
  private samplesSent = 0;
  private text: string[] = [];
  private words: SttWord[] = [];
  private language: string | undefined;
  private turn = 0;
  configuration: Record<string, unknown> | null = null;

  constructor(private options: SttOptions) {}

  async connect() {
    const { onClose, onError, language_codes } = this.options;
    const params = new URLSearchParams({
      model: DEEPGRAM_MODEL,
      language: "multi",
      encoding: "linear16",
      sample_rate: String(STT_SAMPLE_RATE),
      channels: "1",
      punctuate: "true",
      interim_results: "true",
      endpointing: String(DEEPGRAM_ENDPOINTING_MS),
      // A fallback end-of-turn signal for when background noise keeps the
      // silence timer from firing.
      utterance_end_ms: "1000",
    });
    for (const code of language_codes ?? []) params.append("language_hint", code);

    // The browser reaches Deepgram through the local relay, which adds the API
    // key. See lib/deepgram/relay.ts.
    const ws = new WebSocket(`${await fetchDeepgramRelay()}/?${params}`);
    ws.binaryType = "arraybuffer";
    this.ws = ws;
    this.configuration = { model: DEEPGRAM_MODEL, endpointing: DEEPGRAM_ENDPOINTING_MS };

    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onmessage = (event) => {
        if (typeof event.data === "string") this.handle(JSON.parse(event.data));
      };
      ws.onerror = () =>
        reject(new Error("Could not reach the local Deepgram relay. Restart the dev server."));
      ws.onclose = (event) => {
        reject(new Error(`Deepgram closed on connect (${event.code} ${event.reason})`));
        if (this.ws === ws) onClose(`${event.code} ${event.reason}`.trim());
      };
    });
    void onError;
  }

  private handle(message: {
    type: string;
    is_final?: boolean;
    speech_final?: boolean;
    channel?: { alternatives?: { transcript: string; words?: DeepgramWord[]; languages?: string[] }[] };
  }) {
    if (message.type === "UtteranceEnd") return this.finish();
    if (message.type !== "Results") return;
    const alternative = message.channel?.alternatives?.[0];
    const transcript = alternative?.transcript ?? "";

    if (message.is_final && transcript) {
      this.text.push(transcript);
      this.language = alternative?.languages?.[0] ?? this.language;
      for (const word of alternative?.words ?? []) {
        this.words.push({
          text: word.punctuated_word ?? word.word,
          start: word.start * 1000,
          end: word.end * 1000,
          confidence: word.confidence,
        });
      }
    }
    if (message.speech_final) return this.finish();

    const soFar = [...this.text, message.is_final ? "" : transcript].filter(Boolean).join(" ");
    if (soFar) this.emit(soFar, false);
  }

  private finish() {
    if (!this.text.length) return;
    this.emit(this.text.join(" "), true);
    this.text = [];
    this.words = [];
    this.language = undefined;
    this.turn++;
  }

  private emit(transcript: string, end: boolean) {
    const turn: TurnMessage = {
      type: "Turn",
      turn_order: this.turn,
      end_of_turn: end,
      transcript,
      words: this.words,
      language_code: end ? this.language?.slice(0, 2) : undefined,
    };
    this.options.onTurn(turn);
  }

  sendAudio(pcm: ArrayBuffer) {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(pcm);
    this.samplesSent += pcm.byteLength / 2;
  }

  get audioClockMs() {
    return (this.samplesSent / STT_SAMPLE_RATE) * 1000;
  }

  /**
   * Deepgram fixes languages, keyterms and endpointing when the socket opens,
   * so the mid-session updates the agent sends to AssemblyAI have no
   * counterpart here. That difference is part of what is being compared.
   */
  update() {}

  close() {
    const ws = this.ws;
    this.ws = null;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "CloseStream" }));
    ws?.close();
  }
}
