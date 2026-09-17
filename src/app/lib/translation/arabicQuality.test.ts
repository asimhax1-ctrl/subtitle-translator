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

  it("returns true for Arabic regional subtags", () => {
    expect(isArabicTarget("ar-SA")).toBe(true);
    expect(isArabicTarget("ar-EG")).toBe(true);
    expect(isArabicTarget("ar-AE")).toBe(true);
  });

  it("returns false for non-Arabic language codes", () => {
    expect(isArabicTarget("en")).toBe(false);
    expect(isArabicTarget("zh")).toBe(false);
    expect(isArabicTarget("en-ar")).toBe(false);
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

  it("ignores allowed proper names and honorifics", () => {
    const allowed = ["New York", "Herr Schmidt", "Sensei"];
    expect(detectUntranslatedSource("I love New York", "أحب New York", allowed)).toBe(false);
    expect(detectUntranslatedSource("Guten Morgen, Herr Schmidt.", "صباح الخير، Herr Schmidt.", allowed)).toBe(false);
    expect(detectUntranslatedSource("Good morning, Sensei.", "صباح الخير، Sensei.", allowed)).toBe(false);
  });

  it("ignores all-caps acronyms in the identity branch", () => {
    expect(detectUntranslatedSource("NASA", "NASA")).toBe(false);
    expect(detectUntranslatedSource("FBI", "FBI")).toBe(false);
  });

  it("still flags material leaks of non-allowed source text", () => {
    expect(detectUntranslatedSource("Where are you going?", "أين أنت going?")).toBe(true);
    expect(detectUntranslatedSource("Hello world", "مرحبا world")).toBe(true);
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

  it("preserves URLs and query strings", () => {
    expect(normalizeArabicPunctuation("زور https://x.com/a?b=1&c=2 الآن")).toBe("زور https://x.com/a?b=1&c=2 الآن");
  });

  it("preserves email addresses", () => {
    expect(normalizeArabicPunctuation("راسلني a.b@x.com, شكرا")).toBe("راسلني a.b@x.com، شكرا");
  });

  it("preserves numeric literals with Latin grouping separators", () => {
    expect(normalizeArabicPunctuation("القيمة 1,000 دولار")).toBe("القيمة 1,000 دولار");
  });

  it("preserves preserved Latin fragments in mixed dialogue", () => {
    expect(normalizeArabicPunctuation('اضغط ثم اكتب "What?"')).toBe('اضغط ثم اكتب "What?"');
  });

  it("preserves ASS override tags", () => {
    expect(normalizeArabicPunctuation("{\\pos(400,570)}مرحبا, كيف حالك?")).toBe("{\\pos(400,570)}مرحبا، كيف حالك؟");
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

  it("does not chain common sentence-initial words into fake names", () => {
    expect(extractLikelyProperNouns("Then John left. Then John returned.")).toEqual(["John"]);
    expect(extractLikelyProperNouns("Good Morning, sir. Good Morning to you.")).toEqual([]);
    expect(extractLikelyProperNouns("Wait, stop. Wait a moment.")).toEqual([]);
    expect(extractLikelyProperNouns("Come On, hurry. Come On.")).toEqual([]);
  });

  it("extracts all-caps names common in SRT files", () => {
    expect(extractLikelyProperNouns("JOHN: Come here. JOHN: Listen.")).toEqual(["JOHN"]);
  });

  it("extracts Katakana names for anime sources", () => {
    expect(extractLikelyProperNouns("タナカ said hello. タナカ left.")).toEqual(["タナカ"]);
  });

  it("extracts hyphenated and apostrophe names", () => {
    expect(extractLikelyProperNouns("Jean-Luc left. Jean-Luc returned.")).toEqual(["Jean-Luc"]);
    expect(extractLikelyProperNouns("O'Brien left. O'Brien returned.")).toEqual(["O'Brien"]);
  });

  it("strips Japanese honorifics and extracts the base name", () => {
    expect(extractLikelyProperNouns("Tanaka-san left. Tanaka-san returned.")).toEqual(["Tanaka"]);
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
