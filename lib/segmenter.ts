import { isLang, type Lang } from "./languages";

export type Segment = { lang: Lang; text: string };

const TRAILING_PUNCT = /[.,!?;:…)»”"']/;
const HAS_SPEECH = /[\p{L}\p{N}]/u;
// Below this length a finished sentence waits for the next one, so the TTS
// model gets enough context for natural prosody ("Great!" alone sounds clipped).
const MIN_SENTENCE_CHARS = 24;

/**
 * Splits the LLM's token stream into single-language segments.
 *
 * The tutor writes its native-language reply as plain text and wraps anything
 * in another language in a tag named after the language code:
 *
 *   In Spanish you say <es>buenos días</es>. Try it!
 *
 * A TTS session speaks exactly one language, so each segment is routed to the
 * session for its language. Native text is also cut at sentence ends so audio
 * starts before the LLM has finished writing.
 */
export class Segmenter {
  private lang: Lang;
  private buf = "";
  private tag: string | null = null;
  // A foreign segment whose closing tag has arrived. It is held back one step
  // so that punctuation right after the tag is spoken with it, rather than
  // becoming a punctuation-only segment in the native voice.
  private held: Segment | null = null;

  constructor(
    private native: Lang,
    private emit: (segment: Segment) => void,
  ) {
    this.lang = native;
  }

  push(chunk: string) {
    for (const ch of chunk) this.char(ch);
  }

  end() {
    if (this.tag !== null) {
      this.buf += this.tag;
      this.tag = null;
    }
    this.releaseHeld();
    this.flush();
  }

  private char(ch: string) {
    if (this.tag !== null) {
      this.tag += ch;
      if (ch === ">") this.closeTag();
      else if (this.tag.length > 5) {
        // Not one of our tags (for example "a < b"): keep it as text.
        this.text(this.tag);
        this.tag = null;
      }
      return;
    }
    if (ch === "<") {
      this.tag = "<";
      return;
    }
    if (this.held) {
      if (TRAILING_PUNCT.test(ch)) {
        this.held.text += ch;
        return;
      }
      this.releaseHeld();
    }
    this.text(ch);
  }

  private text(s: string) {
    this.buf += s;
    if (this.lang !== this.native) return;
    // A sentence has ended once whitespace follows its terminal punctuation.
    if (/\s$/.test(s) && /[.!?…]["')»”]?\s+$/.test(this.buf)) {
      if (this.buf.trim().length >= MIN_SENTENCE_CHARS) this.flush();
    }
  }

  private closeTag() {
    const match = /^<(\/?)([a-z]{2})>$/.exec(this.tag!);
    this.tag = null;
    if (!match || !isLang(match[2])) return; // unknown markup is dropped
    const [, closing, code] = match;
    if (!closing) {
      this.releaseHeld();
      this.flush();
      this.lang = code as Lang;
    } else if (this.lang === code && this.lang !== this.native) {
      const text = clean(this.buf);
      this.buf = "";
      this.held = HAS_SPEECH.test(text) ? { lang: this.lang, text } : null;
      this.lang = this.native;
    } // a stray closing tag is ignored
  }

  private releaseHeld() {
    if (this.held) this.emit({ ...this.held, text: clean(this.held.text) });
    this.held = null;
  }

  private flush() {
    const text = clean(this.buf);
    this.buf = "";
    if (HAS_SPEECH.test(text)) this.emit({ lang: this.lang, text });
  }
}

function clean(s: string) {
  // Quote marks around a tagged phrase end up stranded at segment edges.
  return s
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["“”«»']+\s*|\s*["“«']+$/g, "");
}

/** Removes language tags, leaving the reply as plain text. */
export function stripTags(s: string) {
  return s.replace(/<\/?[a-z]{2}>/g, "").replace(/\s+/g, " ").trim();
}
