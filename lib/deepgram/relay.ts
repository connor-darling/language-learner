import { WebSocket, WebSocketServer } from "ws";

// A local WebSocket relay for Deepgram, used only by the comparison mode.
//
// AssemblyAI hands the browser a short-lived token, so the browser can connect
// to it directly. Deepgram's equivalent needs an API key with a role many keys
// don't have, so instead the browser connects here and this process forwards
// the audio to Deepgram with the key attached. The key stays on the server
// either way. The extra hop is on localhost and adds well under a millisecond.

export const RELAY_PORT = Number(process.env.DEEPGRAM_RELAY_PORT) || 3001;
const UPSTREAM = "wss://api.deepgram.com/v1/listen";

// Next.js can load this module more than once in development.
const state = globalThis as { deepgramRelayStarted?: boolean };

export function startDeepgramRelay() {
  if (state.deepgramRelayStarted || !process.env.DEEPGRAM_API_KEY) return;
  state.deepgramRelayStarted = true;

  const server = new WebSocketServer({ port: RELAY_PORT, host: "127.0.0.1" });
  server.on("error", (error) => {
    console.warn(`Deepgram relay could not start on port ${RELAY_PORT}: ${error.message}`);
  });

  server.on("connection", (client, request) => {
    // Only pages served from this machine may use the relay.
    const origin = request.headers.origin ?? "";
    if (origin && !/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin)) {
      client.close(1008, "origin not allowed");
      return;
    }

    const query = request.url?.split("?")[1] ?? "";
    const upstream = new WebSocket(`${UPSTREAM}?${query}`, {
      headers: { Authorization: `Token ${process.env.DEEPGRAM_API_KEY}` },
    });

    // Audio can arrive before the upstream socket is open; hold it until then.
    const waiting: { data: WebSocket.RawData; binary: boolean }[] = [];
    client.on("message", (data, binary) => {
      if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary });
      else waiting.push({ data, binary });
    });
    upstream.on("open", () => {
      for (const { data, binary } of waiting.splice(0)) upstream.send(data, { binary });
    });
    upstream.on("message", (data, binary) => {
      if (client.readyState === WebSocket.OPEN) client.send(data, { binary });
    });

    upstream.on("unexpected-response", (_request, response) => {
      client.close(1011, `Deepgram refused the connection (HTTP ${response.statusCode})`);
    });
    upstream.on("error", () => client.close(1011, "Deepgram connection failed"));
    upstream.on("close", (code, reason) => {
      if (client.readyState === WebSocket.OPEN) {
        client.close(code >= 1000 && code < 5000 && code !== 1005 && code !== 1006 ? code : 1011, reason.toString().slice(0, 100));
      }
    });
    client.on("close", () => upstream.close());
    client.on("error", () => upstream.close());
  });
}
