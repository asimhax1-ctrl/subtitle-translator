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
- Translate titles and honorifics (Mr., Mrs., Sir, Madam, Captain, Doctor, -san, -kun, -chan, -sama, senpai, sensei...) to match the on-screen social relationship, not literally.
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

/**
 * Detect whether an Arabic translation still accidentally contains original
 * source-language text. The check is conservative: it only flags lines where
 * a significant Latin word from the source appears verbatim in the translation,
 * or where the translation is essentially identical to the source.
 *
 * Gated on the target being Arabic; callers should still pass the source
 * language so future variants can tune heuristics per script.
 */
export const detectUntranslatedSource = (source: string, translated: string): boolean => {
  if (!source || !translated || source === translated) return source.length > 0 && /\p{L}/u.test(source);

  // If source and translation are essentially the same (ignoring case and
  // diacritics), the line was not translated.
  const normalize = (s: string) =>
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
      .replace(/[^\p{L}\p{N}]/gu, "")
      .trim();
  if (normalize(source) === normalize(translated) && normalize(source).length > 0) return true;

  // Extract Latin tokens from the source and see if any significant one
  // survived verbatim in the translation.
  const latinTokens = (source.match(/[a-zA-Z]+/g) ?? []).filter(isSignificantLatinToken);
  if (latinTokens.length === 0) return false;

  const lowerTranslated = translated.toLowerCase();
  let verbatimHits = 0;
  for (const token of latinTokens) {
    // Word-boundary match in the translation to avoid matching substrings.
    const re = new RegExp(`(?<![a-zA-Z])${token}(?![a-zA-Z])`, "i");
    if (re.test(lowerTranslated)) verbatimHits++;
  }

  // Flag when at least one significant source token leaked through, or when
  // most of the Latin text leaked through.
  return verbatimHits > 0 && verbatimHits >= Math.min(1, Math.floor(latinTokens.length * 0.5));
};

// Arabic punctuation normalization map. Only applied when target is Arabic.
const ARABIC_PUNCTUATION_MAP: Record<string, string> = {
  "?": "؟",
  ",": "،",
  ";": "؛",
};

/**
 * Normalize punctuation inside Arabic text to Arabic-appropriate marks.
 * Non-Arabic text is left untouched so mixed-language lines stay readable.
 */
export const normalizeArabicPunctuation = (text: string): string => {
  if (!text || !/[\u0600-\u06FF]/.test(text)) return text;
  return text.replace(/[?,,;]/g, (ch) => ARABIC_PUNCTUATION_MAP[ch] ?? ch);
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
