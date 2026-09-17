import { describe, expect, it } from "vitest";
import {
  appendArabicSystemPrompt,
  appendDiscoveredTerms,
  detectUntranslatedSource,
  extractLikelyProperNouns,
  isArabicTarget,
  normalizeArabicPunctuation,
} from "@/app/lib/translation/arabicQuality";
import { DEFAULT_SYSTEM_PROMPT } from "@/app/lib/translation/config";

describe("isArabicTarget", () => {
  it("returns true for the Arabic language code", () => {
    expect(isArabicTarget("ar")).toBe(true);
  });

  it("returns false for non-Arabic language codes", () => {
    expect(isArabicTarget("en")).toBe(false);
    expect(isArabicTarget("zh")).toBe(false);
    expect(isArabicTarget("ar-SA")).toBe(false);
  });
});

describe("appendArabicSystemPrompt", () => {
  it("appends Arabic-specific instructions when target language is Arabic", () => {
    const enhanced = appendArabicSystemPrompt(DEFAULT_SYSTEM_PROMPT, "ar");
    expect(enhanced).toContain("Modern Standard Arabic");
    expect(enhanced).toContain("Signore");
    expect(enhanced).toContain("سيدي");
    expect(enhanced).toContain(DEFAULT_SYSTEM_PROMPT);
    expect(enhanced.length).toBeGreaterThan(DEFAULT_SYSTEM_PROMPT.length);
  });

  it("does not modify the prompt for non-Arabic targets", () => {
    expect(appendArabicSystemPrompt(DEFAULT_SYSTEM_PROMPT, "zh")).toBe(DEFAULT_SYSTEM_PROMPT);
    expect(appendArabicSystemPrompt(DEFAULT_SYSTEM_PROMPT, "en")).toBe(DEFAULT_SYSTEM_PROMPT);
  });

  it("avoids duplicating the appendix if already present", () => {
    const first = appendArabicSystemPrompt(DEFAULT_SYSTEM_PROMPT, "ar");
    const second = appendArabicSystemPrompt(first, "ar");
    expect(second).toBe(first);
  });
});

describe("detectUntranslatedSource", () => {
  it("flags a line that was returned unchanged", () => {
    expect(detectUntranslatedSource("Hello world", "Hello world")).toBe(true);
  });

  it("flags a translation that still contains a long source word", () => {
    expect(detectUntranslatedSource("Where are you going?", "أين أنت going?")).toBe(true);
  });

  it("does not flag a fully translated Arabic line", () => {
    expect(detectUntranslatedSource("Hello world", "مرحبا بالعالم")).toBe(false);
  });

  it("ignores short common tokens such as OK or TV", () => {
    expect(detectUntranslatedSource("OK, see you", "حسنا، أراك later")).toBe(false);
  });

  it("ignores all-caps acronyms", () => {
    expect(detectUntranslatedSource("Report to NASA", "تقرير إلى NASA")).toBe(false);
  });

  it("ignores source lines that have no translatable Latin text", () => {
    expect(detectUntranslatedSource("123", "123")).toBe(false);
  });
});

describe("normalizeArabicPunctuation", () => {
  it("converts Latin question marks to Arabic question marks", () => {
    expect(normalizeArabicPunctuation("هل أنت بخير?")).toBe("هل أنت بخير؟");
  });

  it("converts Latin commas to Arabic commas", () => {
    expect(normalizeArabicPunctuation("أهلا, كيف حالك?")).toBe("أهلا، كيف حالك؟");
  });

  it("converts Latin semicolons to Arabic semicolons", () => {
    expect(normalizeArabicPunctuation("تعال؛ هنا")).toBe("تعال؛ هنا");
  });

  it("leaves already Arabic punctuation unchanged", () => {
    expect(normalizeArabicPunctuation("هل أنت بخير؟")).toBe("هل أنت بخير؟");
  });

  it("leaves non-Arabic text unchanged", () => {
    expect(normalizeArabicPunctuation("Hello, world!")).toBe("Hello, world!");
  });
});

describe("extractLikelyProperNouns", () => {
  it("extracts recurring capitalized names", () => {
    const text = "John said hello. Mary looked at John. Then John left with Mary.";
    expect(extractLikelyProperNouns(text)).toEqual(["John", "Mary"]);
  });

  it("ignores common sentence-case words", () => {
    const text = "The quick brown Fox jumped over the lazy dog. A Fox is an animal.";
    expect(extractLikelyProperNouns(text)).not.toContain("The");
    expect(extractLikelyProperNouns(text)).not.toContain("over");
  });

  it("requires a minimum length and repeated occurrence", () => {
    const text = "Al is short. Bob is short. Al and Bob met. Bob left.";
    expect(extractLikelyProperNouns(text)).toEqual(["Bob"]);
  });

  it("returns an empty array for text without proper nouns", () => {
    expect(extractLikelyProperNouns("hello world how are you")).toEqual([]);
  });
});

describe("appendDiscoveredTerms", () => {
  it("appends discovered terms when target is Arabic", () => {
    const prompt = appendDiscoveredTerms(DEFAULT_SYSTEM_PROMPT, "ar", ["John", "Mary"]);
    expect(prompt).toContain("John");
    expect(prompt).toContain("Mary");
    expect(prompt).toContain("keep their Arabic transliteration consistent");
  });

  it("does not append anything for non-Arabic targets", () => {
    expect(appendDiscoveredTerms(DEFAULT_SYSTEM_PROMPT, "zh", ["John", "Mary"])).toBe(DEFAULT_SYSTEM_PROMPT);
  });

  it("does not append anything when the term list is empty", () => {
    expect(appendDiscoveredTerms(DEFAULT_SYSTEM_PROMPT, "ar", [])).toBe(DEFAULT_SYSTEM_PROMPT);
  });
});
