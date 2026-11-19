// Mints a short-lived AssemblyAI token so the browser can open its own STT and
// TTS WebSockets. The API key never leaves the server.


import { RELAY_PORT } from "@/lib/deepgram/relay";

const TOKEN_URL = "https://token.us.assemblyai.com/v1/token";
const PRODUCTS = ["streaming", "tts"] as const;
type Product = (typeof PRODUCTS)[number];

export async function POST(request: Request) {
  const { product } = (await request.json()) as { product?: Product | "deepgram" };
  if (product === "deepgram") return deepgramRelay();

  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "ASSEMBLYAI_API_KEY is not set" }, { status: 500 });
  }
  if (!product || !PRODUCTS.includes(product)) {
    return Response.json({ error: "product must be streaming, tts or deepgram" }, { status: 400 });
  }

  // A token can open any product unless narrowed, so switch off everything
  // except the one this connection needs.
  const access: Record<string, { enabled: false }> = {
    speech_to_speech: { enabled: false },
    llm_gateway: { enabled: false },
  };
  for (const other of PRODUCTS) if (other !== product) access[other] = { enabled: false };

  let upstream: Response;
  try {
    upstream = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { Authorization: apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ product, expires_in_seconds: 60, access }),
    });
  } catch {
    // A network or DNS failure. Answer with JSON so the page can show a real message.
    return Response.json(
      { error: "Could not reach AssemblyAI to get a token. Check your connection and try again." },
      { status: 502 },
    );
  }
  if (!upstream.ok) {
    return Response.json(
      { error: `token request failed (${upstream.status})`, detail: await upstream.text() },
      { status: 502 },
    );
  }
  const { token } = (await upstream.json()) as { token: string };
  return Response.json({ token });
}

/**
 * Deepgram has no token to hand out here: the browser reaches it through the
 * local relay (lib/deepgram/relay.ts), which holds the key. This just tells the
 * browser where the relay is, or why it isn't available.
 */
function deepgramRelay() {
  if (!process.env.DEEPGRAM_API_KEY) {
    return Response.json(
      { error: "DEEPGRAM_API_KEY is not set in .env. Add it and restart the dev server." },
      { status: 500 },
    );
  }
  return Response.json({ relayPort: RELAY_PORT });
}
