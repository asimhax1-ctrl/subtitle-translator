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
