// Short acknowledgements a listener makes while someone else is talking. While
// the tutor is speaking, a turn made only of these does not interrupt it.
// "yes" / "no" (and their translations) are deliberately absent: they are answers.
const BACKCHANNELS = new Set([
  "mhm", "mm", "mmm", "hmm", "hm", "uh", "um", "uhhuh", "ah", "oh", "ooh",
  "yeah", "yep", "ok", "okay", "right", "sure", "cool", "nice", "wow",
  "vale", "ya", "aja", "ajá", "claro", // es
  "ouais", "bah", "euh", // fr
  "genau", "ach", "aha", // de
  "ecco", "beh", // it
  "tá", "pois", // pt
]);

function words(text: string) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Whether speech heard while the tutor is talking should cut it off.
 * Follows AssemblyAI's guidance: don't act on SpeechStarted alone, wait for
 * transcript text, and ignore it when it is under two words or all filler.
 */
export function isInterruption(transcript: string) {
  const w = words(transcript);
  if (w.length < 2) return false;
  return !w.every((x) => BACKCHANNELS.has(x));
}

/** A whole turn that is nothing but an acknowledgement. */
export function isBackchannel(transcript: string) {
  const w = words(transcript);
  return w.length > 0 && w.every((x) => BACKCHANNELS.has(x));
}
