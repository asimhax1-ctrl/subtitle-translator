// Arabic-first subtitle quality helpers.
//
// These functions are intentionally pure and gated on the target language so
// non-Arabic translations are never affected. Business logic lives here;
// pipeline.ts only wires the hooks.

/** True for the Arabic target-language code used throughout the app. */
export const isArabicTarget = (lang: string): boolean => lang === "ar";

const ARABIC_SYSTEM_PROMPT_APPENDIX = `

--- Arabic output instructions ---
Translate into natural Modern Standard Arabic (العربية الفصحى), not literal word-for-word translation.
- Keep character names and proper nouns consistent across the whole work; transliterate into common Arabic conventions.
- Translate titles and honorifics to match the on-screen social relationship, not literally. Examples:
  • "Signore" (Italian) → "سيدي" when addressing a man, never "يا رب".
  • "Monsieur" / "Herr" → "سيدي" or "سيّدي" depending on formality.
  • "Sensei" (Japanese) → "أستاذي" for a teacher/mentor, or keep "سينسي" when the Japanese term itself is intended.
  • "Senpai" (Japanese) → "الزميل الأكبر" or keep "سينباي" when the term is intended.
  • "-san", "-kun", "-chan", "-sama" → choose an Arabic title or keep the honorific transliterated, based on the relationship shown.
- Preserve embedded foreign words (English, Italian, German, French, Japanese, Latin, etc.) when the scene expects them to stay foreign; transliterate greetings and honorifics intentionally.
- Match verb/adjective gender and number to the intended speaker or referent.
- Keep subtitles cinematic, concise, and subtitle-length appropriate.
- Use Arabic punctuation (e.g. ؟ instead of ?) when it improves readability.
`;

/**
 * Append Arabic-specific instructions to the system prompt when translating
 * into Arabic. Idempotent: calling twice with the same prompt returns the same
 * result so repeated normalizations do not stack the appendix.
 */
export const appendArabicSystemPrompt = (systemPrompt: string, targetLanguage: string): string => {
  if (!isArabicTarget(targetLanguage)) return systemPrompt;
  if (systemPrompt.includes(ARABIC_SYSTEM_PROMPT_APPENDIX.trim())) return systemPrompt;
  return `${systemPrompt}${ARABIC_SYSTEM_PROMPT_APPENDIX}`;
};

// Minimum Latin-word length that counts as evidence of an untranslated fragment.
// Short tokens like "OK", "TV", or "no" are common intentional borrowings in
// Arabic subtitles and are ignored to avoid false-positive retries.
const MIN_SOURCE_TOKEN_LENGTH = 4;

// A token is "significant" when it is long enough and not an all-caps acronym
// that the user likely wants preserved (NASA, FBI, etc.).
const isSignificantLatinToken = (token: string): boolean =>
  token.length >= MIN_SOURCE_TOKEN_LENGTH && token !== token.toUpperCase();

// Foreign honorifics and address terms that the Arabic appendix explicitly
// allows to remain in their original form (or be transliterated) depending on
// context. They must not trigger the untranslated-source repair on their own.
const FOREIGN_HONORIFICS = new Set([
  "herr", "monsieur", "signore", "signor", "sensei", "senpai",
  "san", "kun", "chan", "sama",
]);

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Detect whether an Arabic translation still accidentally contains original
 * source-language text. The check is conservative: it only flags lines where
 * a significant Latin word from the source appears verbatim in the translation,
 * or where the translation is essentially identical to the source.
 *
 * `allowedTerms` lists source phrases (glossary sources, discovered names,
 * honorifics) that are permitted to remain in Latin form. This prevents wasted
 * repairs on intentional preservation of proper nouns and foreign honorifics.
 *
 * Gated on the target being Arabic; callers should still pass the source
 * language so future variants can tune heuristics per script.
 */
export const detectUntranslatedSource = (source: string, translated: string, allowedTerms: string[] = []): boolean => {
  if (!source || !translated) return false;

  // Build a whitelist of Latin words that are allowed to survive.
  const whitelist = new Set<string>();
  for (const term of allowedTerms) {
    for (const word of term.match(/[a-zA-Z]+/g) ?? []) {
      if (isSignificantLatinToken(word)) whitelist.add(word.toLowerCase());
    }
  }
  for (const word of FOREIGN_HONORIFICS) whitelist.add(word);

  const extractSignificantTokens = (s: string): string[] =>
    (s.match(/[a-zA-Z]+/g) ?? []).filter((t) => isSignificantLatinToken(t) && !whitelist.has(t.toLowerCase()));

  // If source and translation are essentially the same (ignoring case and
  // diacritics), the line was not translated — unless every Latin token is an
  // allowed acronym or proper name.
  const normalize = (s: string) =>
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
      .replace(/[^\p{L}\p{N}]/gu, "")
      .trim();
  if (normalize(source) === normalize(translated) && normalize(source).length > 0) {
    return extractSignificantTokens(source).length > 0;
  }

  // Extract Latin tokens from the source and see if any significant one
  // survived verbatim in the translation.
  const latinTokens = extractSignificantTokens(source);
  if (latinTokens.length === 0) return false;

  const lowerTranslated = translated.toLowerCase();
  let verbatimHits = 0;
  for (const token of latinTokens) {
    // Word-boundary match in the translation to avoid matching substrings.
    const re = new RegExp(`(?<![a-zA-Z])${escapeRegExp(token)}(?![a-zA-Z])`, "i");
    if (re.test(lowerTranslated)) verbatimHits++;
  }

  // Flag when at least one significant source token leaked through, or when
  // most of the Latin text leaked through.
  return verbatimHits > 0 && verbatimHits >= Math.max(1, Math.floor(latinTokens.length * 0.5));
};

// Arabic punctuation normalization map. Only applied when target is Arabic.
const ARABIC_PUNCTUATION_MAP: Record<string, string> = {
  "?": "؟",
  ",": "،",
  ";": "؛",
};

const ARABIC_SCRIPT_RE = /[\u0600-\u06FF]/;

/**
 * Normalize punctuation inside Arabic text to Arabic-appropriate marks.
 * Only converts punctuation that is adjacent to Arabic script; Latin-only
 * fragments (URLs, emails, numbers, preserved foreign words, ASS/ICU braces)
 * are left untouched so mixed-language lines stay readable and subtitle
 * structure/tags are not corrupted.
 */
export const normalizeArabicPunctuation = (text: string): string => {
  if (!text || !ARABIC_SCRIPT_RE.test(text)) return text;

  // Protect spans that must keep Latin punctuation verbatim: ASS/ICU braces,
  // URLs, and email addresses. Restore them after normalizing.
  const protectedSpans = new Map<string, string>();
  let counter = 0;
  const protect = (match: string): string => {
    const key = `__PROTECT_${counter++}__`;
    protectedSpans.set(key, match);
    return key;
  };

  let protectedText = text
    .replace(/\{[^{}]*\}/g, protect)
    .replace(/https?:\/\/\S+/gi, protect)
    // Email: stop before trailing punctuation so the following Arabic comma
    // (e.g. "a.b@x.com, شكرا") is not swallowed into the protected span.
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, protect);

  // Only convert a punctuation mark when it has an Arabic-script neighbor
  // (skipping adjacent whitespace). This keeps Latin fragments ("What?",
  // "1,000", code) intact while converting Arabic-script punctuation
  // ("مرحبا, كيف حالك?").
  protectedText = protectedText.replace(/[?,,;]/g, (ch, offset, str) => {
    const findNeighbor = (start: number, step: 1 | -1): string => {
      for (let i = start; i >= 0 && i < str.length; i += step) {
        const c = str.charAt(i);
        if (!/\s/.test(c)) return c;
      }
      return "";
    };
    const prev = findNeighbor(offset - 1, -1);
    const next = findNeighbor(offset + 1, 1);
    if (ARABIC_SCRIPT_RE.test(prev) || ARABIC_SCRIPT_RE.test(next)) {
      return ARABIC_PUNCTUATION_MAP[ch] ?? ch;
    }
    return ch;
  });

  return protectedText.replace(/__PROTECT_\d+__/g, (key) => protectedSpans.get(key) ?? key);
};

// Common words that may be capitalized by chance but are not proper nouns.
const COMMON_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for", "of", "with", "by", "from", "as", "is", "was", "are", "were", "be", "been", "being", "have", "has", "had", "do", "does", "did", "will", "would", "could", "should", "may", "might", "must", "shall", "can", "need", "dare", "ought", "used", "this", "that", "these", "those", "i", "you", "he", "she", "it", "we", "they", "my", "your", "his", "her", "its", "our", "their", "what", "which", "who", "when", "where", "why", "how", "all", "each", "every", "both", "few", "more", "most", "other", "some", "such", "no", "nor", "not", "only", "own", "same", "so", "than", "too", "very", "just", "now", "then", "here", "there", "up", "down", "out", "off", "over", "under", "again", "further", "once", "also",
]);

const MIN_TERM_LENGTH = 3;
const MIN_OCCURRENCES = 2;

/**
 * Extract likely proper nouns / recurring names from source text using a
 * lightweight heuristic. Only Latin-script words are considered because the
 * main use case is discovering foreign names that need consistent Arabic
 * transliteration. The heuristic requires the word to appear at least twice
 * and filters out a small list of common words.
 */
export const extractLikelyProperNouns = (text: string): string[] => {
  if (!text) return [];
  const counts = new Map<string, number>();
  const words = text.match(/[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*/g) ?? [];
  for (const word of words) {
    const key = word.trim();
    if (key.length < MIN_TERM_LENGTH) continue;
    if (COMMON_WORDS.has(key.toLowerCase())) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count >= MIN_OCCURRENCES)
    .map(([word]) => word)
    .sort();
};

const DISCOVERED_TERMS_HEADER = "\n\nRecurring names/terms discovered in this work — keep their Arabic transliteration consistent throughout:";

/**
 * Append a discovered-terms block to the system prompt for Arabic targets.
 * The block is only added when terms were found and the target is Arabic.
 * Idempotent: repeated calls with the same terms do not stack the block.
 */
export const appendDiscoveredTerms = (systemPrompt: string, targetLanguage: string, terms: string[]): string => {
  if (!isArabicTarget(targetLanguage) || terms.length === 0) return systemPrompt;
  const block = `${DISCOVERED_TERMS_HEADER}\n${terms.map((t) => `- ${t}`).join("\n")}`;
  if (systemPrompt.includes(block.trim())) return systemPrompt;
  return `${systemPrompt}${block}`;
};
