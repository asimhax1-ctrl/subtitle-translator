import { describe, expect, it } from "vitest";
import { generateCacheSuffix } from "@/app/lib/translation/cache";
import type { TranslationConfig } from "@/app/lib/translation/types";

// A prompt that uses ${fullText} makes each line's translation depend on the
// WHOLE document (the model sees the full text when translating each line).
// The cache suffix must therefore include that document, or the same source
// line in two different documents replays the first document's translation
// with zero wire traffic (silent cross-document contamination).
const base = {
  sourceLanguage: "ja",
  targetLanguage: "zh",
  translationMethod: "deepseek",
  config: { model: "deepseek-flash" } as TranslationConfig,
  systemPrompt: "professional translator",
};

const CONTENT_PROMPT = "Translate ${content}";
const FULLTEXT_PROMPT = "Translate ${content} using the context of ${fullText}";

describe("generateCacheSuffix fullText sensitivity", () => {
  it("isolates documents when the prompt uses ${fullText}", () => {
    const a = generateCacheSuffix({ ...base, userPrompt: FULLTEXT_PROMPT, fullText: "doc A\nline" });
    const b = generateCacheSuffix({ ...base, userPrompt: FULLTEXT_PROMPT, fullText: "doc B\nline" });
    expect(a).not.toBe(b);
  });

  it("keeps the same suffix across documents when ${fullText} is not used", () => {
    const a = generateCacheSuffix({ ...base, userPrompt: CONTENT_PROMPT, fullText: "doc A\nline" });
    const b = generateCacheSuffix({ ...base, userPrompt: CONTENT_PROMPT, fullText: "doc B\nline" });
    expect(a).toBe(b);
  });

  it("stays stable for the same document and prompt", () => {
    const a = generateCacheSuffix({ ...base, userPrompt: FULLTEXT_PROMPT, fullText: "doc A\nline" });
    const b = generateCacheSuffix({ ...base, userPrompt: FULLTEXT_PROMPT, fullText: "doc A\nline" });
    expect(a).toBe(b);
  });
});
