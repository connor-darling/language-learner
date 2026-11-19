// Runs once when the Next.js server starts.
export async function register() {
  // The relay uses Node's networking, so it must not load in the edge runtime.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startDeepgramRelay } = await import("./lib/deepgram/relay");
    startDeepgramRelay();
  }
}
