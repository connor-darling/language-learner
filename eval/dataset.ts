import type { Lang } from "../lib/languages";

/**
 * The four kinds of thing a learner says to a language tutor. Each stresses
 * the speech-to-text model differently, so the report breaks results out by kind.
 */
export type Kind =
  /** A question in the native language. Baseline accuracy. */
  | "ask"
  /** The learner repeating a phrase in the target language. Short, no context. */
  | "attempt"
  /** A native-language sentence with target-language words inside it. */
  | "mixed"
  /** An attempt containing a real learner mistake. The transcript must keep the mistake. */
  | "near_miss";

export type Item = {
  id: string;
  kind: Kind;
  /** The language being learned in this item. */
  target: Lang;
  /** What is said, as single-language pieces. Joined, this is the reference transcript. */
  say: { lang: Lang; text: string }[];
  /** For attempts and near misses: the phrase the tutor had just taught. */
  taught?: string;
};

const en = (text: string) => ({ lang: "en" as const, text });
const t = (lang: Lang, text: string) => ({ lang, text });

export const DATASET: Item[] = [
  // --- ask -------------------------------------------------------------------
  { id: "ask-es", kind: "ask", target: "es", say: [en("How do you say good morning in Spanish?")] },
  { id: "ask-fr", kind: "ask", target: "fr", say: [en("How do I say nice to meet you in French?")] },
  { id: "ask-de", kind: "ask", target: "de", say: [en("What's the German word for train station?")] },
  { id: "ask-it", kind: "ask", target: "it", say: [en("Can you teach me how to order a coffee in Italian?")] },
  { id: "ask-pt", kind: "ask", target: "pt", say: [en("How would I ask where the bathroom is in Portuguese?")] },

  // --- attempt ---------------------------------------------------------------
  { id: "att-es-1", kind: "attempt", target: "es", say: [t("es", "Buenos días.")], taught: "buenos días" },
  { id: "att-es-2", kind: "attempt", target: "es", say: [t("es", "Mucho gusto en conocerte.")], taught: "mucho gusto en conocerte" },
  { id: "att-fr-1", kind: "attempt", target: "fr", say: [t("fr", "Enchanté.")], taught: "enchanté" },
  { id: "att-fr-2", kind: "attempt", target: "fr", say: [t("fr", "Je voudrais un café, s'il vous plaît.")], taught: "je voudrais un café s'il vous plaît" },
  { id: "att-de-1", kind: "attempt", target: "de", say: [t("de", "Guten Morgen.")], taught: "guten Morgen" },
  { id: "att-de-2", kind: "attempt", target: "de", say: [t("de", "Wo ist der Bahnhof?")], taught: "wo ist der Bahnhof" },
  { id: "att-it-1", kind: "attempt", target: "it", say: [t("it", "Buongiorno.")], taught: "buongiorno" },
  { id: "att-it-2", kind: "attempt", target: "it", say: [t("it", "Vorrei un caffè, per favore.")], taught: "vorrei un caffè per favore" },
  { id: "att-pt-1", kind: "attempt", target: "pt", say: [t("pt", "Bom dia.")], taught: "bom dia" },
  { id: "att-pt-2", kind: "attempt", target: "pt", say: [t("pt", "Onde fica o banheiro?")], taught: "onde fica o banheiro" },

  // --- mixed -----------------------------------------------------------------
  { id: "mix-es", kind: "mixed", target: "es", say: [en("What does"), t("es", "mucho gusto"), en("mean?")] },
  { id: "mix-fr", kind: "mixed", target: "fr", say: [en("Is it"), t("fr", "bonjour"), en("or"), t("fr", "bonsoir"), en("in the evening?")] },
  { id: "mix-de", kind: "mixed", target: "de", say: [en("Can I say"), t("de", "guten Abend"), en("late at night?")] },
  { id: "mix-it", kind: "mixed", target: "it", say: [en("How is"), t("it", "grazie mille"), en("different from just"), t("it", "grazie?")] },
  { id: "mix-pt", kind: "mixed", target: "pt", say: [en("Does"), t("pt", "obrigado"), en("change if a woman says it?")] },

  // --- near_miss -------------------------------------------------------------
  // Each is a mistake learners really make, and each wrong form is a real word,
  // so a model has no excuse for "fixing" it other than expecting the right answer.
  { id: "miss-es-1", kind: "near_miss", target: "es", say: [t("es", "Buenos tardes.")], taught: "buenas tardes" },
  { id: "miss-es-2", kind: "near_miss", target: "es", say: [t("es", "Estoy caliente.")], taught: "tengo calor" },
  { id: "miss-fr-1", kind: "near_miss", target: "fr", say: [t("fr", "Je suis faim.")], taught: "j'ai faim" },
  { id: "miss-de-1", kind: "near_miss", target: "de", say: [t("de", "Ich bin kalt.")], taught: "mir ist kalt" },
  { id: "miss-it-1", kind: "near_miss", target: "it", say: [t("it", "Io sono fame.")], taught: "ho fame" },
  { id: "miss-pt-1", kind: "near_miss", target: "pt", say: [t("pt", "Eu sou com fome.")], taught: "estou com fome" },
];

export function reference(item: Item) {
  return item.say.map((piece) => piece.text).join(" ");
}
