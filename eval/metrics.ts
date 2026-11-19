/** Lowercase, drop punctuation, keep accented letters (they matter to a learner). */
export function normalize(text: string): string[] {
  return text
    .normalize("NFC")
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^\p{L}\p{N}'\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** Word error rate: word-level edit distance over reference length. */
export function wer(reference: string, hypothesis: string) {
  const ref = normalize(reference);
  const hyp = normalize(hypothesis);
  let row = Array.from({ length: hyp.length + 1 }, (_, j) => j);
  for (let i = 1; i <= ref.length; i++) {
    const next = [i];
    for (let j = 1; j <= hyp.length; j++) {
      next[j] = Math.min(
        row[j] + 1,
        next[j - 1] + 1,
        row[j - 1] + (ref[i - 1] === hyp[j - 1] ? 0 : 1),
      );
    }
    row = next;
  }
  return { errors: row[hyp.length], words: ref.length };
}

/** Whether `phrase` appears in `text` as a run of whole words. */
export function containsPhrase(text: string, phrase: string) {
  const haystack = ` ${normalize(text).join(" ")} `;
  return haystack.includes(` ${normalize(phrase).join(" ")} `);
}

export function percentile(values: number[], p: number) {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}
