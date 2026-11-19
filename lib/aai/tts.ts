import { TTS_SAMPLE_RATE } from "../audio/player";
import { LANGS, type Lang } from "../languages";
import { fetchToken } from "./token";

const TTS_URL = "wss://tts.us.assemblyai.com/v1/ws";
const KEEPALIVE_MS = 60_000; // the server closes a socket idle for two minutes

export type TtsEvents = {
  onAudio: (segmentId: string, pcm: Int16Array) => void;
  onSegmentDone: (segmentId: string) => void;
  onError: (message: string) => void;
};

/**
 * One AssemblyAI streaming TTS session, which speaks one language in one voice
 * for its whole life. The agent holds one of these per language it speaks.
 *
 * Each segment is sent as Generate + Flush, so it is one "request" on the wire.
 * The server answers requests in order and never interleaves their audio, so a
 * FIFO of segment ids is enough to know which segment an Audio frame belongs to.
 */
export class TtsSession {
  private ws: WebSocket | null = null;
  private opening: Promise<void> | null = null;
  private pending: string[] = [];
  // Cancels the server has not yet acknowledged. Audio that arrives while this
  // is above zero belongs to a request from before the cancel and is dropped.
  private unackedCancels = 0;
  private keepAlive: ReturnType<typeof setInterval> | null = null;
  private closed = false;

  constructor(
    readonly lang: Lang,
    readonly voiceId: string,
    private events: TtsEvents,
  ) {}

  /** Opens the socket. Safe to call early and repeatedly; reconnects if it dropped. */
  open(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) return Promise.resolve();
    this.opening ??= this.connect().finally(() => (this.opening = null));
    return this.opening;
  }

  private async connect() {
    const params = new URLSearchParams({
      token: await fetchToken("tts"),
      voice_id: this.voiceId,
      language: LANGS[this.lang].tts,
      sample_rate: String(TTS_SAMPLE_RATE),
      encoding: "pcm_s16le",
      word_boundaries: "false",
    });
    const ws = new WebSocket(`${TTS_URL}?${params}`);
    this.ws = ws;
    this.unackedCancels = 0;

    let refusal: Refusal | null = null;
    await new Promise<void>((resolve, reject) => {
      ws.onmessage = (event) => {
        const frame = JSON.parse(event.data as string);
        if (frame.type === "Begin") resolve();
        // A refused session gets an Error frame, then the socket closes.
        else if (frame.type === "Error") refusal = frame;
        else this.handle(frame);
      };
      ws.onerror = () => reject(new Error(`could not connect to TTS (${this.lang})`));
      ws.onclose = (event) => {
        reject(new Error(describeRefusal("voice", event.code, refusal)));
        if (this.ws !== ws) return;
        this.ws = null;
        // Anything still waiting will never get audio; release it so playback
        // of later segments is not stuck behind it.
        for (const id of this.pending.splice(0)) this.events.onSegmentDone(id);
      };
    });

    if (this.keepAlive) clearInterval(this.keepAlive);
    this.keepAlive = setInterval(() => this.send({ type: "KeepAlive" }), KEEPALIVE_MS);
  }

  private handle(frame: { type: string; audio?: string; error?: string }) {
    if (frame.type === "Cancelled") {
      this.unackedCancels = Math.max(0, this.unackedCancels - 1);
      return;
    }
    if (frame.type === "Error") {
      this.events.onError(`TTS ${this.lang}: ${frame.error}`);
      return;
    }
    if (this.unackedCancels > 0) return;
    if (frame.type === "Audio" && frame.audio && this.pending.length) {
      this.events.onAudio(this.pending[0], decodePcm(frame.audio));
    } else if (frame.type === "FlushDone") {
      const id = this.pending.shift();
      if (id) this.events.onSegmentDone(id);
    }
  }

  async speak(segmentId: string, text: string) {
    this.pending.push(segmentId);
    try {
      await this.open();
    } catch (error) {
      this.pending = this.pending.filter((id) => id !== segmentId);
      this.events.onSegmentDone(segmentId);
      this.events.onError(String(error));
      return;
    }
    // Cancelled while the socket was still opening.
    if (!this.pending.includes(segmentId)) return;
    this.send({ type: "Generate", text });
    this.send({ type: "Flush" });
  }

  /** Barge-in: stop synthesis and discard everything not yet heard. */
  cancel() {
    if (!this.pending.length) return;
    this.pending = [];
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.unackedCancels++;
      this.send({ type: "Cancel" });
    }
  }

  close() {
    this.closed = true;
    if (this.keepAlive) clearInterval(this.keepAlive);
    const ws = this.ws;
    this.ws = null;
    this.pending = [];
    ws?.close();
  }

  private send(frame: object) {
    if (!this.closed && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(frame));
    }
  }
}

function decodePcm(base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Int16Array(bytes.buffer, 0, bytes.length >> 1);
}

export type Refusal = { error?: string; error_code?: number; retry_after_seconds?: number | null };

/**
 * Turns a refused connection into something a person can act on. The common
 * case is the per-minute cap on new sessions (five on a free plan), which is
 * easy to hit by starting and ending sessions in quick succession.
 */
export function describeRefusal(what: string, code: number, refusal: Refusal | null) {
  const text = refusal?.error ?? "";
  if (code === 3009 || /too many/i.test(text)) {
    const wait = refusal?.retry_after_seconds ?? /retry in (\d+)/i.exec(text)?.[1];
    return `AssemblyAI is limiting new ${what} sessions on this account (five per minute on a free plan). ${
      wait ? `Try again in ${wait} seconds.` : "Wait a minute and try again."
    }`;
  }
  return `Could not open a ${what} session (${code}${text ? `: ${text}` : ""}).`;
}
