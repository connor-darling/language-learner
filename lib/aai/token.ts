/** Asks our own server for a temporary AssemblyAI token, so no API key reaches the browser. One per connection. */
export async function fetchToken(product: "streaming" | "tts"): Promise<string> {
  const data = await post(product);
  return data.token as string;
}

/** Where the local Deepgram relay is listening. */
export async function fetchDeepgramRelay(): Promise<string> {
  const data = await post("deepgram");
  return `ws://127.0.0.1:${data.relayPort}`;
}

async function post(product: string) {
  const response = await fetch("/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ product }),
  });
  // If the server failed badly enough to send no JSON, still report something useful.
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? `token request failed (${response.status})`);
  return data;
}
