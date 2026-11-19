import { isLang } from "@/lib/languages";
import { systemPrompt } from "@/lib/prompt";

// Streams the tutor's reply from the AssemblyAI LLM Gateway as plain text.
// The gateway speaks the chat-completions SSE format; the browser only needs
// the text deltas, so they are unwrapped here.

const GATEWAY_URL = "https://llm-gateway.assemblyai.com/v1/chat/completions";
const DEFAULT_MODEL = "gemma-4-31b";

type ChatMessage = { role: "user" | "assistant"; content: string };

export async function POST(request: Request) {
  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "ASSEMBLYAI_API_KEY is not set" }, { status: 500 });
  }

  const body = (await request.json()) as {
    messages?: ChatMessage[];
    native?: string;
    focus?: string;
  };
  const { messages, native, focus } = body;
  if (!messages?.length || !native || !focus || !isLang(native) || !isLang(focus)) {
    return Response.json({ error: "messages, native and focus are required" }, { status: 400 });
  }

  const model = process.env.LLM_MODEL || DEFAULT_MODEL;
  const upstream = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: { Authorization: apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: true,
      max_tokens: 300,
      temperature: 0.4,
      messages: [{ role: "system", content: systemPrompt(native, focus) }, ...messages],
    }),
    signal: request.signal, // a barge-in aborts the browser fetch, which aborts this
  });

  if (!upstream.ok || !upstream.body) {
    return Response.json(
      { error: `LLM Gateway error (${upstream.status})`, detail: await upstream.text() },
      { status: 502 },
    );
  }

  return new Response(upstream.body.pipeThrough(sseToText()), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-LLM-Model": model,
    },
  });
}

function sseToText() {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const data = line.startsWith("data:") ? line.slice(5).trim() : "";
        if (!data || data === "[DONE]") continue;
        try {
          const delta = JSON.parse(data).choices?.[0]?.delta?.content;
          if (typeof delta === "string" && delta) controller.enqueue(encoder.encode(delta));
        } catch {
          // keep-alive comments and partial frames are not JSON; skip them
        }
      }
    },
  });
}
