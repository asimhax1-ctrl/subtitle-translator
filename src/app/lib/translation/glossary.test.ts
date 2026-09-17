import { describe, expect, it } from "vitest";
import { buildGlossaryPromptBlock } from "@/app/lib/translation/glossary";

describe("buildGlossaryPromptBlock", () => {
  const terms = [{ source: "Spike", target: "سبايك", targetLang: "ar" }];

  it("uses standard wording for non-Arabic targets", () => {
    const block = buildGlossaryPromptBlock(terms, "zh");
    expect(block).toContain("Glossary — always translate");
    expect(block).not.toContain("MANDATORY");
    expect(block).toContain("Spike → سبايك");
  });

  it("uses mandatory wording for Arabic targets", () => {
    const block = buildGlossaryPromptBlock(terms, "ar");
    expect(block).toContain("MANDATORY GLOSSARY");
    expect(block).toContain("MUST appear");
    expect(block).toContain("Spike → سبايك");
  });

  it("returns an empty string when there are no terms", () => {
    expect(buildGlossaryPromptBlock([], "ar")).toBe("");
  });
});
