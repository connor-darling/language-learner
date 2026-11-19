// Generates the evaluation audio with AssemblyAI text-to-speech.
//
// This is a bootstrap so the harness runs end to end without recordings. All
// learner audio is spoken by one English-recorded voice, including the Spanish,
// French, German, Italian and Portuguese: a voice speaking outside the language
// it was recorded in is the closest synthetic stand-in for a learner's accent.
// It is still synthetic. For a real evaluation, replace eval/audio/*.wav with
// the customer's own recordings (16 kHz mono 16-bit WAV, same file names).

import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { LANGS } from "../lib/languages";
import { STT_SAMPLE_RATE } from "../lib/stt-config";
import { DATASET, type Item } from "./dataset";

process.loadEnvFile(".env");

const LEARNER_VOICE = "aai-sara";
const AUDIO_DIR = path.join(import.meta.dirname, "audio");
const GAP_MS = 70; // pause between language switches inside one utterance

async function speak(text: string, language: string): Promise<Int16Array> {
  const response = await fetch("https://tts.us.assemblyai.com/v1/speech", {
    method: "POST",
    headers: {
      Authorization: process.env.ASSEMBLYAI_API_KEY!,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text,
      language,
      voice_id: LEARNER_VOICE,
      sample_rate: STT_SAMPLE_RATE,
      encoding: "pcm_s16le",
      container: "raw",
      stream: false,
    }),
  });
  if (!response.ok) throw new Error(`TTS ${response.status}: ${await response.text()}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  return trimSilence(new Int16Array(bytes.buffer, 0, bytes.length >> 1));
}

/** Cuts leading and trailing silence so "end of speech" is where the file ends. */
function trimSilence(pcm: Int16Array) {
  const threshold = 400;
  let start = 0;
  let end = pcm.length;
  while (start < end && Math.abs(pcm[start]) < threshold) start++;
  while (end > start && Math.abs(pcm[end - 1]) < threshold) end--;
  const pad = STT_SAMPLE_RATE * 0.02;
  return pcm.slice(Math.max(0, start - pad), Math.min(pcm.length, end + pad));
}

function wav(pcm: Int16Array) {
  const header = Buffer.alloc(44);
  const dataBytes = pcm.length * 2;
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataBytes, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(STT_SAMPLE_RATE, 24);
  header.writeUInt32LE(STT_SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataBytes, 40);
  return Buffer.concat([header, Buffer.from(pcm.buffer, pcm.byteOffset, dataBytes)]);
}

async function synthesize(item: Item) {
  const pieces = await Promise.all(item.say.map((p) => speak(p.text, LANGS[p.lang].tts)));
  const gap = new Int16Array((STT_SAMPLE_RATE * GAP_MS) / 1000);
  const parts = pieces.flatMap((piece, i) => (i ? [gap, piece] : [piece]));
  const pcm = new Int16Array(parts.reduce((n, part) => n + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    pcm.set(part, offset);
    offset += part.length;
  }
  return pcm;
}

await mkdir(AUDIO_DIR, { recursive: true });
const force = process.argv.includes("--force");
for (const item of DATASET) {
  const file = path.join(AUDIO_DIR, `${item.id}.wav`);
  if (existsSync(file) && !force) continue;
  const pcm = await synthesize(item);
  await writeFile(file, wav(pcm));
  console.log(`${item.id}.wav  ${(pcm.length / STT_SAMPLE_RATE).toFixed(1)}s`);
}
console.log(`Audio is in ${AUDIO_DIR}`);
