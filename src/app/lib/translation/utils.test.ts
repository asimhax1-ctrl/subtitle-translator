import { describe, expect, it } from "vitest";
import { getAIModelPromptParts } from "@/app/lib/translation/utils";
import { buildContextPrompt } from "@/app/lib/translation/contextTranslation";
import { DEFAULT_USER_PROMPT } from "@/app/lib/translation/config";

// Regression tests for the "${content}" placeholder contract.
//
// The engine inserts the source text at the template's `${content}` marker.
// A custom user prompt that omits the marker used to make the engine send the
// instructions with NO source text at all — the model then answers "I don't
// see any content to translate" (subtitle-translator#68) while the run is
// reported as a success. The content must always reach the model: at the
// marker when present, appended otherwise.

const CONTENT = "Hello, world!";

describe("getAIModelPromptParts content delivery", () => {
  it("inserts content at the ${content} marker", () => {
    const { prefix, suffix } = getAIModelPromptParts(CONTENT, `Translate into \${targetLanguage}:\n\n\${content}`, "zh", "en");
    expect(prefix).toContain("Translate into Simplified Chinese:");
    expect(suffix).toContain(CONTENT);
  });

  it("appends content when the template omits every content placeholder", () => {
    const { prefix, suffix } = getAIModelPromptParts(CONTENT, "Translate into ${targetLanguage}.", "zh", "en");
    expect(prefix).toContain("Translate into Simplified Chinese.");
    expect(`${prefix}${suffix}`).toContain(CONTENT);
  });

  it("does not duplicate content when the template only uses ${fullText}", () => {
    const full = `line one\n${CONTENT}`;
    const { prefix, suffix } = getAIModelPromptParts(CONTENT, "Summarize ${fullText}", "zh", "en", full);
    expect(prefix).toContain(CONTENT);
    expect(suffix).toBe("");
    expect(`${prefix}${suffix}`.split(CONTENT).length - 1).toBe(1);
  });

  it("still resolves ${targetLanguage} exactly once when appending content", () => {
    const { prefix, suffix } = getAIModelPromptParts(CONTENT, "Rewrite in ${targetLanguage}", "zh", "en");
    expect(`${prefix}${suffix}`.split("Simplified Chinese").length - 1).toBe(1);
    expect(`${prefix}${suffix}`).toContain(CONTENT);
  });
});

describe("buildContextPrompt keeps the marker block reachable", () => {
  it("replaces the ${content} marker in a compliant template", () => {
    const out = buildContextPrompt(DEFAULT_USER_PROMPT, 3, "subtitle");
    expect(out).toContain("[TRANSLATE_X]");
    expect(out).toContain("${content}");
  });

  it("appends the context instructions when the template has no ${content}", () => {
    const out = buildContextPrompt("Rewrite the following in ${targetLanguage}.", 3, "subtitle");
    expect(out).toContain("Rewrite the following in ${targetLanguage}.");
    expect(out).toContain("[TRANSLATE_X]");
    // The marker block is delivered LAST by getAIModelPromptParts — the template
    // must therefore still carry the placeholder after the instructions.
    expect(out).toContain("${content}");
  });
});
