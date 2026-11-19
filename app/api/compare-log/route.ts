import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

// Appends one side-by-side turn (what each provider heard, and how fast) to
// eval/results/live.jsonl. A local development convenience: it writes to the
// project folder, so it is switched off in production builds.

const FILE = path.join(process.cwd(), "eval", "results", "live.jsonl");

export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return Response.json({ error: "logging is only available in development" }, { status: 403 });
  }
  const entry = await request.json();
  await mkdir(path.dirname(FILE), { recursive: true });
  await appendFile(FILE, JSON.stringify({ at: new Date().toISOString(), ...entry }) + "\n");
  return Response.json({ ok: true });
}
