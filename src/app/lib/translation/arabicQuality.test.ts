import { describe, expect, it } from "vitest";
import { appendArabicSystemPrompt, isArabicTarget } from "@/app/lib/translation/arabicQuality";
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
