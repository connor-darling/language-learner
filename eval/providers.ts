import WebSocket from "ws";
import type { Lang } from "../lib/languages";
import { STT_MODEL, STT_SAMPLE_RATE } from "../lib/stt-config";

/** One finished turn as a provider reported it. */
export type Final = { text: string; at: number; lang?: string };

export type Session = {
  /** Send 16 kHz mono 16-bit PCM. */
  send(pcm: Buffer): void;
  close(): void;
};

export type Request = {
  /** Languages to expect: the learner's own and the one they are learning. */
  languages: Lang[];
  /** Phrases to boost, or none. */
  keyterms: string[];
  silence: { min_turn_silence: number; max_turn_silence: number };
  onFinal(final: Final): void;
};

/**
 * A streaming speech-to-text provider. To evaluate another vendor, implement
 * this one function: open a socket, and call `onFinal` each time the vendor
 * says the speaker has finished a turn.
 */
export type Provider = {
  name: string;
  available(): boolean;
  open(request: Request): Promise<Session>;
};

function opened(ws: WebSocket, name: string) {
  return new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", (error) => reject(new Error(`${name}: ${error.message}`)));
    ws.once("unexpected-response", (_request, response) =>
      reject(new Error(`${name}: HTTP ${response.statusCode} on connect`)),
    );
  });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const assemblyai: Provider = {
  name: "assemblyai",
  available: () => !!process.env.ASSEMBLYAI_API_KEY,
  async open(request) {
    // New sessions are rate limited per minute (5 on a free plan). The server
    // accepts the socket, then sends an Error frame saying when to retry.
    for (let attempt = 0; ; attempt++) {
      try {
        return await openAssemblyAI(request);
      } catch (error) {
        const retryAfter = (error as { retryAfter?: number }).retryAfter;
        if (retryAfter === undefined || attempt >= 20) throw error;
        await sleep((retryAfter + 1 + Math.random() * 3) * 1000);
      }
    }
  },
};

async function openAssemblyAI({ languages, keyterms, silence, onFinal }: Request): Promise<Session> {
  const params = new URLSearchParams({
    speech_model: STT_MODEL,
    sample_rate: String(STT_SAMPLE_RATE),
    language_codes: JSON.stringify(languages),
    language_detection: "true",
    min_turn_silence: String(silence.min_turn_silence),
    max_turn_silence: String(silence.max_turn_silence),
  });
  if (keyterms.length) params.set("keyterms_prompt", JSON.stringify(keyterms));

  const ws = new WebSocket(`wss://streaming.assemblyai.com/v3/ws?${params}`, {
    headers: { Authorization: process.env.ASSEMBLYAI_API_KEY! },
  });
  // The session is usable once Begin arrives, not when the socket opens.
  await new Promise<void>((resolve, reject) => {
    let failure: Error | null = null;
    ws.on("message", (data, isBinary) => {
      if (isBinary) return;
      const message = JSON.parse(data.toString());
      if (message.type === "Begin") {
        if (process.env.EVAL_DEBUG) console.log("assemblyai Begin", JSON.stringify(message.configuration));
        resolve();
      } else if (message.type === "Error") {
        if (process.env.EVAL_DEBUG) console.log("assemblyai Error", JSON.stringify(message));
        const text = String(message.error ?? message.message ?? "");
        const seconds = /retry in (\d+)/i.exec(text)?.[1];
        failure = Object.assign(new Error(`assemblyai: ${message.error_code ?? ""} ${text}`.trim()), {
          retryAfter: message.retry_after_seconds ?? (seconds ? Number(seconds) : /too many/i.test(text) ? 20 : undefined),
        });
      } else if (message.type === "Turn" && message.end_of_turn && message.transcript.trim()) {
        onFinal({ text: message.transcript, at: performance.now(), lang: message.language_code });
      }
    });
    ws.once("error", (error) => reject(new Error(`assemblyai: ${error.message}`)));
    ws.once("close", (code, reason) =>
      reject(failure ?? new Error(`assemblyai: closed before Begin (${code} ${reason})`)),
    );
  });
  return {
    send: (pcm) => ws.readyState === WebSocket.OPEN && ws.send(pcm),
    close() {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "Terminate" }));
      ws.close();
    },
  };
}

/**
 * Deepgram, configured the way its docs recommend for multilingual
 * code-switching: Nova-3 with `language=multi`. A turn ends at `speech_final`,
 * and its text is every `is_final` segment since the last one.
 *
 * DEEPGRAM_ENDPOINTING_MS defaults to 300, the low end of what Deepgram
 * suggests for conversation. Set it to whatever the customer runs today.
 */
export const deepgram: Provider = {
  name: "deepgram",
  available: () => !!process.env.DEEPGRAM_API_KEY,
  async open({ languages, keyterms, onFinal }) {
    const params = new URLSearchParams({
      model: process.env.DEEPGRAM_MODEL || "nova-3",
      language: "multi",
      encoding: "linear16",
      sample_rate: String(STT_SAMPLE_RATE),
      channels: "1",
      punctuate: "true",
      interim_results: "true",
      endpointing: process.env.DEEPGRAM_ENDPOINTING_MS || "300",
    });
    for (const language of languages) params.append("language_hint", language);
    for (const keyterm of keyterms) params.append("keyterm", keyterm);

    const ws = new WebSocket(`wss://api.deepgram.com/v1/listen?${params}`, {
      headers: { Authorization: `Token ${process.env.DEEPGRAM_API_KEY}` },
    });
    let segments: string[] = [];
    ws.on("message", (data, isBinary) => {
      if (isBinary) return;
      const message = JSON.parse(data.toString());
      if (message.type !== "Results") return;
      const alternative = message.channel?.alternatives?.[0];
      if (message.is_final && alternative?.transcript) segments.push(alternative.transcript);
      if (message.speech_final && segments.length) {
        onFinal({
          text: segments.join(" "),
          at: performance.now(),
          lang: alternative?.languages?.[0],
        });
        segments = [];
      }
    });
    await opened(ws, "deepgram");
    return {
      send: (pcm) => ws.send(pcm),
      close() {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "CloseStream" }));
        ws.close();
      },
    };
  },
};
