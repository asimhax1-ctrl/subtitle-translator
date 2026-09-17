import { describe, expect, it } from "vitest";
import { translateLines, type PipelineRuntimeConfig } from "@/app/lib/translation/pipeline";
import { DEFAULT_SYSTEM_PROMPT } from "@/app/lib/translation/config";
import type { TranslateTextParams } from "@/app/lib/translation/types";

// Regression tests for Arabic-first prompt injection.
//
// When the target language is Arabic, the pipeline must append Arabic-specific
// instructions to the effective system prompt so the model receives guidance on
// names, honorifics, gender agreement, mixed-language dialogue, and punctuation.
// Non-Arabic targets must remain untouched.

const makeConfig = (): PipelineRuntimeConfig => ({
  translationMethod: "deepseek",
  targetLanguage: "ar",
  sourceLanguage: "en",
  useCache: false,
  model: "deepseek-flash",
  contextWindow: 2,
  contextBatchSize: 1,
  batchSize: 1,
});

describe("Arabic prompt injection", () => {
  it("sends Arabic-specific instructions when target language is Arabic", async () => {
    let capturedSystemPrompt = "";
    const translate = async (params: TranslateTextParams): Promise<string> => {
      capturedSystemPrompt = params.systemPrompt ?? "";
      return "[TRANSLATE_0]مرحبا[/TRANSLATE_0]";
    };

    await translateLines(["Hello"], makeConfig(), { translate }, "subtitle");
    expect(capturedSystemPrompt).toContain("Modern Standard Arabic");
    expect(capturedSystemPrompt).toContain("honorifics");
  });

  it("does not append Arabic instructions for non-Arabic targets", async () => {
    let capturedSystemPrompt = "";
    const translate = async (params: TranslateTextParams): Promise<string> => {
      capturedSystemPrompt = params.systemPrompt ?? "";
      return "[TRANSLATE_0]你好[/TRANSLATE_0]";
    };

    await translateLines(["Hello"], { ...makeConfig(), targetLanguage: "zh" }, { translate }, "subtitle");
    expect(capturedSystemPrompt).toBe(DEFAULT_SYSTEM_PROMPT);
    expect(capturedSystemPrompt).not.toContain("Modern Standard Arabic");
  });

  it("preserves a user-provided Arabic system prompt while still appending the appendix", async () => {
    let capturedSystemPrompt = "";
    const translate = async (params: TranslateTextParams): Promise<string> => {
      capturedSystemPrompt = params.systemPrompt ?? "";
      return "[TRANSLATE_0]مرحبا[/TRANSLATE_0]";
    };

    const customPrompt = "You are a cinematic Arabic subtitle translator.";
    await translateLines(["Hello"], { ...makeConfig(), systemPrompt: customPrompt }, { translate }, "subtitle");
    expect(capturedSystemPrompt).toContain(customPrompt);
    expect(capturedSystemPrompt).toContain("Modern Standard Arabic");
  });
});

describe("Arabic untranslated-source repair", () => {
  it("retries a line that still contains the source text", async () => {
    let calls = 0;
    const translate = async (params: TranslateTextParams): Promise<string> => {
      calls++;
      const isRepair = (params.systemPrompt ?? "").includes("CRITICAL: The previous output");
      if (isRepair) return "مرحبا";
      return "Hello";
    };

    const outcome = await translateLines(["Hello"], makeConfig(), { translate }, "subtitle");
    expect(calls).toBe(2);
    expect(outcome.lines).toEqual(["مرحبا"]);
    expect(outcome.failures).toEqual([]);
  });

  it("keeps the original bad translation if the retry still leaks source text", async () => {
    const translate = async (): Promise<string> => "Hello";

    const outcome = await translateLines(["Hello"], makeConfig(), { translate }, "subtitle");
    expect(outcome.lines).toEqual(["Hello"]);
  });
});

describe("Arabic punctuation normalization", () => {
  it("normalizes Latin punctuation in Arabic output", async () => {
    const translate = async (): Promise<string> => "هل أنت بخير?";

    const outcome = await translateLines(["Are you okay?"], makeConfig(), { translate }, "subtitle");
    expect(outcome.lines).toEqual(["هل أنت بخير؟"]);
  });
});

describe("Arabic discovered terminology memory", () => {
  it("includes recurring names in the system prompt for Arabic targets", async () => {
    let capturedSystemPrompt = "";
    const translate = async (params: TranslateTextParams): Promise<string> => {
      capturedSystemPrompt = params.systemPrompt ?? "";
      return "مرحبا";
    };

    await translateLines(
      ["John said hello.", "Mary looked at John.", "John and Mary left."],
      makeConfig(),
      { translate },
      "subtitle",
    );
    expect(capturedSystemPrompt).toContain("John");
    expect(capturedSystemPrompt).toContain("Mary");
    expect(capturedSystemPrompt).toContain("keep their Arabic transliteration consistent");
  });

  it("does not include discovered terms for non-Arabic targets", async () => {
    let capturedSystemPrompt = "";
    const translate = async (params: TranslateTextParams): Promise<string> => {
      capturedSystemPrompt = params.systemPrompt ?? "";
      return "你好";
    };

    await translateLines(
      ["John said hello.", "Mary looked at John.", "John and Mary left."],
      { ...makeConfig(), targetLanguage: "zh" },
      { translate },
      "subtitle",
    );
    expect(capturedSystemPrompt).not.toContain("John");
    expect(capturedSystemPrompt).not.toContain("keep their Arabic transliteration consistent");
  });
});
