import { describe, expect, it } from "vitest";
import { appendArabicSystemPrompt, detectUntranslatedSource, isArabicTarget, normalizeArabicPunctuation } from "@/app/lib/translation/arabicQuality";
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
