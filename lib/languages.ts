// The six languages AssemblyAI TTS speaks today. STT covers 32, so this list is
// the binding constraint on what the tutor can teach out loud.
export const LANGS = {
  en: { name: "English", tts: "english", voice: "aai-kyla" },
  es: { name: "Spanish", tts: "spanish", voice: "aai-constanza" },
  fr: { name: "French", tts: "french", voice: "aai-donatien" },
  de: { name: "German", tts: "german", voice: "aai-magdalena" },
  it: { name: "Italian", tts: "italian", voice: "aai-giada" },
  pt: { name: "Portuguese", tts: "portuguese", voice: "aai-benicio" },
} as const;

export type Lang = keyof typeof LANGS;
export const LANG_CODES = Object.keys(LANGS) as Lang[];

export function isLang(code: string): code is Lang {
  return code in LANGS;
}
