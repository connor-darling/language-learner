import { STT_MODEL, STT_SAMPLE_RATE as MIC_SAMPLE_RATE } from "../stt-config";
import { fetchToken } from "./token";
import { describeRefusal, type Refusal } from "./tts";

const STT_URL = "wss://streaming.assemblyai.com/v3/ws";
export { STT_MODEL };

export type SttWord = { text: string; start: number; end: number; confidence: number };

export type TurnMessage = {
  type: "Turn";
  turn_order: number;
  end_of_turn: boolean;
  transcript: string;
  words: SttWord[];
  language_code?: string;
  language_confidence?: number;
};

/** Settings that can be changed mid-session with UpdateConfiguration. */
export type SttLiveConfig = {
  language_codes?: string[];
  keyterms_prompt?: string[];
  agent_context?: string;
  min_turn_silence?: number;
  max_turn_silence?: number;
};

export type SttOptions = SttLiveConfig & {
  onTurn: (turn: TurnMessage) => void;
  onClose: (reason: string) => void;
  onError: (message: string) => void;
};

/** Browser client for AssemblyAI streaming speech-to-text. */
export class SttClient {
  private ws: WebSocket | null = null;
  private samplesSent = 0;
  /** What the server says it applied; worth checking, since unknown params are ignored. */
  configuration: Record<string, unknown> | null = null;

  constructor(private options: SttOptions) {}

  async connect() {
    const { onTurn, onClose, onError, ...config } = this.options;
    const params = new URLSearchParams({
      token: await fetchToken("streaming"),
      speech_model: STT_MODEL,
      sample_rate: String(MIC_SAMPLE_RATE),
      // Reports the language of each finished turn. It does not change
      // transcription; language_codes is what steers the model.
      language_detection: "true",
    });
    for (const [key, value] of Object.entries(config)) {
      if (value === undefined) continue;
      params.set(key, typeof value === "object" ? JSON.stringify(value) : String(value));
    }

    const ws = new WebSocket(`${STT_URL}?${params}`);
    ws.binaryType = "arraybuffer";
    this.ws = ws;

    let refusal: Refusal | null = null;
    this.configuration = null;
    await new Promise<void>((resolve, reject) => {
      ws.onmessage = (event) => {
        const message = JSON.parse(event.data as string);
        if (message.type === "Begin") {
          this.configuration = message.configuration;
          resolve();
        } else if (message.type === "Turn") {
          onTurn(message as TurnMessage);
        } else if (message.type === "Error") {
          if (this.configuration) onError(`${message.error_code ?? ""} ${message.error ?? ""}`.trim());
          else refusal = message; // refused before the session began
        }
      };
      ws.onerror = () => reject(new Error("could not connect to streaming STT"));
      ws.onclose = (event) => {
        reject(new Error(describeRefusal("speech-to-text", event.code, refusal)));
        // A session refused before it began is reported by the rejection above.
        if (this.ws === ws && this.configuration) onClose(`${event.code} ${event.reason}`.trim());
      };
    });
  }

  sendAudio(pcm: ArrayBuffer) {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(pcm);
    this.samplesSent += pcm.byteLength / 2;
  }

  /**
   * Position of the audio stream in ms. Word timestamps from the server are on
   * the same clock, so `audioClockMs - lastWord.end` when a final turn arrives
   * is how long after the learner stopped talking we got the transcript.
   */
  get audioClockMs() {
    return (this.samplesSent / MIC_SAMPLE_RATE) * 1000;
  }

  update(config: SttLiveConfig) {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ type: "UpdateConfiguration", ...config }));
  }

  close() {
    const ws = this.ws;
    this.ws = null;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "Terminate" }));
    ws?.close();
  }
}
