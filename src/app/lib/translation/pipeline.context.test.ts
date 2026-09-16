import { describe, expect, it } from "vitest";
import { translateLines, type PipelineCache, type PipelineRuntimeConfig } from "@/app/lib/translation/pipeline";
import { generateCacheKey, generateCacheSuffix, generateContextCacheKeys } from "@/app/lib/translation/cache";
import { DEFAULT_SYSTEM_PROMPT, DEFAULT_USER_PROMPT } from "@/app/lib/translation/config";
import type { TranslateTextParams } from "@/app/lib/translation/types";

// Context-aware batching regression tests.
//
// `translateWithContext` requests one LLM call per window and wraps the target
// lines in [TRANSLATE_n] markers while surrounding them with [CONTEXT] lines.
// Slots already decided before the batch runs — blank pre-fills, per-line cache
// prefills (resume), or an earlier retry — must NOT be re-sent as translation
// targets: the write-once guard discards their results anyway, so targeting
// them only inflates input+output tokens (and can perturb line numbering).
//
// These tests drive the real pipeline through its `deps.translate` seam (the
// same hook the web app mocks) and a fake cache, then assert on the exact
// marker block that would be sent to the provider.

const METHOD = "deepseek";
const SOURCE = "ja";
const TARGET = "zh";

const makeConfig = (contextWindow: number): PipelineRuntimeConfig => ({
  translationMethod: METHOD,
  targetLanguage: TARGET,
  sourceLanguage: SOURCE,
  useCache: true,
  model: "deepseek-flash",
  contextWindow,
  contextBatchSize: 1,
  batchSize: 1,
});

const makeCache = (): PipelineCache & { store: Map<string, string> } => {
  const store = new Map<string, string>();
  return {
    store,
    get: async (key: string) => store.get(key) ?? null,
    getMany: async (keys: string[]) => keys.map((key) => store.get(key) ?? null),
    set: async (key: string, value: string) => {
      store.set(key, value);
    },
    delete: async (key: string) => {
      store.delete(key);
    },
  };
};

// Mirrors how runTranslateLines composes the suffix (same config object, same
// effective prompts), so seeded keys match prefillFromLineCache lookups.
const suffixFor = (config: PipelineRuntimeConfig): string =>
  generateCacheSuffix({ sourceLanguage: SOURCE, targetLanguage: TARGET, translationMethod: METHOD, config, systemPrompt: DEFAULT_SYSTEM_PROMPT, userPrompt: DEFAULT_USER_PROMPT });

const TRANSLATE_MARKER_RE = /\[TRANSLATE_(\d+)\]/g;
const countTargets = (text: string): number => (text.match(TRANSLATE_MARKER_RE) ?? []).length;

// Answers exactly the target markers present in the request, keyed by their
// ordinal, so the test can prove which slots the model was asked to translate.
const makeTranslate = (requests: string[]) => async (params: TranslateTextParams): Promise<string> => {
  requests.push(params.text);
  const ordinals = new Set<number>();
  for (const match of params.text.matchAll(TRANSLATE_MARKER_RE)) ordinals.add(Number(match[1]));
  return [...ordinals]
    .sort((a, b) => a - b)
    .map((n) => `[TRANSLATE_${n}]译文${n}[/TRANSLATE_${n}]`)
    .join("\n");
};

describe("context resume isolation", () => {
  it("builds stable keys distinct by position, document, format, and window", () => {
    const lines = ["Same", "Same"];
    const keys = generateContextCacheKeys(lines, "suffix", "subtitle", 2);
    expect(new Set(keys).size).toBe(2);
    expect(generateContextCacheKeys([...lines], "suffix", "subtitle", 2)).toEqual(keys);
    expect(generateContextCacheKeys(["Same", "Other"], "suffix", "subtitle", 2)[0]).not.toBe(keys[0]);
    expect(generateContextCacheKeys(lines, "suffix", "markdown", 2)[0]).not.toBe(keys[0]);
    expect(generateContextCacheKeys(lines, "suffix", "subtitle", 1)[0]).not.toBe(keys[0]);
  });

  it("looks up occurrence keys without shifting past blank source slots", async () => {
    const lines = ["Same", "", "Same"];
    const config = makeConfig(3);
    const cache = makeCache();
    const keys = generateContextCacheKeys(lines, suffixFor(config), "subtitle", 3);
    cache.store.set(keys[0], "第一");
    cache.store.set(keys[2], "第二");
    const requests: string[] = [];
    const outcome = await translateLines(lines, config, { cache, translate: makeTranslate(requests) }, "subtitle");
    expect(outcome.lines).toEqual(["第一", "", "第二"]);
    expect(requests).toEqual([]);
  });
  it("preserves distinct translations of repeated source lines on resume", async () => {
    const lines = ["Right.", "Right."];
    const config = makeConfig(2);
    const cache = makeCache();
    const requests: string[] = [];
    const deps = { cache, translate: makeTranslate(requests) };
    const first = await translateLines(lines, config, deps, "subtitle");
    const resumed = await translateLines(lines, config, deps, "subtitle");

    expect(first.lines).toEqual(["译文0", "译文1"]);
    expect(resumed.lines).toEqual(first.lines);
    expect(requests).toHaveLength(1);
  });

  it("does not reuse a context translation in another document", async () => {
    const config = makeConfig(2);
    const cache = makeCache();
    const requests: string[] = [];
    const deps = { cache, translate: makeTranslate(requests) };
    await translateLines(["Right.", "Turn here"], config, deps, "subtitle");
    await translateLines(["Right.", "That is correct"], config, deps, "subtitle");

    expect(countTargets(requests[1])).toBe(2);
  });

  it("does not prefill context targets from standalone line translations", async () => {
    const config = makeConfig(2);
    const cache = makeCache();
    cache.store.set(generateCacheKey("Right.", suffixFor(config)), "Standalone");
    const requests: string[] = [];
    const outcome = await translateLines(["Right.", "Turn here"], config, { cache, translate: makeTranslate(requests) }, "subtitle");

    expect(countTargets(requests[0])).toBe(2);
    expect(outcome.lines).toEqual(["译文0", "译文1"]);
  });
});

describe("context echo confirmation", () => {
  it("confirms valid translations matching context without repeatedly retrying the same window", async () => {
    const requests: string[] = [];
    const translate = async ({ text }: TranslateTextParams) => {
      requests.push(text);
      return text.includes("[TRANSLATE_0]") ? "[TRANSLATE_0]Yes[/TRANSLATE_0]" : "Yes";
    };
    const outcome = await translateLines(["Yes", "はい"], { ...makeConfig(1), targetLanguage: "en", useCache: false, delayTime: 1 }, { translate }, "subtitle");
    expect(outcome.lines).toEqual(["Yes", "Yes"]);
    expect(outcome.failures).toEqual([]);
    expect(requests).toHaveLength(3);
    expect(requests[2]).toBe("はい");
  });

  it("replaces actual context echoes with an independent translation", async () => {
    const translate = async ({ text }: TranslateTextParams) => {
      if (text === "こんにちは") return "Hello";
      return "[TRANSLATE_0]Goodbye[/TRANSLATE_0]";
    };
    const outcome = await translateLines(["Goodbye", "こんにちは"], { ...makeConfig(1), targetLanguage: "en", useCache: false, delayTime: 1 }, { translate }, "subtitle");
    expect(outcome.lines).toEqual(["Goodbye", "Hello"]);
    expect(outcome.failures).toEqual([]);
  });
});

describe("context batch marker targeting", () => {
  it("targets only untranslated slots in a partially cached batch", async () => {
    const lines = ["A", "B", "C", "D"];
    const config = makeConfig(lines.length);
    const cache = makeCache();
    const suffix = suffixFor(config);
    // B and D are already translated (resume from per-line cache).
    const keys = generateContextCacheKeys(lines, suffix, "subtitle", lines.length);
    cache.store.set(keys[1], "缓存B");
    cache.store.set(keys[3], "缓存D");

    const requests: string[] = [];
    const outcome = await translateLines(lines, config, { cache, translate: makeTranslate(requests) }, "subtitle", {});

    expect(requests).toHaveLength(1);
    const text = requests[0];
    // Only A and C still need translation — 2 targets, not 4.
    expect(countTargets(text)).toBe(2);
    expect(text).not.toContain("[TRANSLATE_1]B");
    expect(text).not.toContain("[TRANSLATE_3]D");
    // The already-decided lines still ride along, once, as context.
    expect(text).toContain("[CONTEXT]B[/CONTEXT]");
    expect(text).toContain("[CONTEXT]D[/CONTEXT]");
    // Output maps back to the original indices: cached slots untouched, pending
    // slots filled in order (ordinal 0 -> A, ordinal 1 -> C).
    expect(outcome.failures).toEqual([]);
    expect(outcome.lines).toEqual(["译文0", "缓存B", "译文1", "缓存D"]);
  });

  it("keeps context before/after the target segment and demotes a cached in-range line to context", async () => {
    const lines = Array.from({ length: 10 }, (_, i) => `L${i}`);
    const config = makeConfig(4);
    const cache = makeCache();
    const suffix = suffixFor(config);
    // L5 sits inside the middle batch's target range but is already decided.
    cache.store.set(generateContextCacheKeys(lines, suffix, "subtitle", 4)[5], "缓存L5");

    const requests: string[] = [];
    const outcome = await translateLines(lines, config, { cache, translate: makeTranslate(requests) }, "subtitle", {});

    // Window 4 over 10 lines, serialized: [0,4) [4,8) [8,10).
    expect(requests).toHaveLength(3);
    const middle = requests[1];
    // Padding = window/2 = 2 → context covers [2,10) around targets [4,8).
    expect(middle).toContain("[CONTEXT]L2[/CONTEXT]");
    expect(middle).toContain("[CONTEXT]L3[/CONTEXT]");
    expect(middle).toContain("[CONTEXT]L8[/CONTEXT]");
    expect(middle).toContain("[CONTEXT]L9[/CONTEXT]");
    // L5 is decided, so it is context — not a third target alongside L4/L6/L7.
    expect(countTargets(middle)).toBe(3);
    expect(middle).toContain("[CONTEXT]L5[/CONTEXT]");
    expect(middle).not.toContain("[TRANSLATE_1]L5");
    // Mapping back to original indices is intact for cached and translated lines.
    expect(outcome.failures).toEqual([]);
    expect(outcome.lines[5]).toBe("缓存L5");
    expect(outcome.lines[0]).toBe("译文0");
    expect(outcome.lines).toHaveLength(10);
    expect(outcome.lines.every((line) => line.length > 0)).toBe(true);
  });

  it("still sends every line as a target when nothing is cached (unchanged happy path)", async () => {
    const lines = ["A", "B", "C", "D"];
    const config = makeConfig(lines.length);
    const cache = makeCache();

    const requests: string[] = [];
    const outcome = await translateLines(lines, config, { cache, translate: makeTranslate(requests) }, "subtitle", {});

    expect(requests).toHaveLength(1);
    const text = requests[0];
    expect(countTargets(text)).toBe(4);
    expect(text).toContain("[TRANSLATE_0]A[/TRANSLATE_0]");
    expect(text).toContain("[TRANSLATE_3]D[/TRANSLATE_3]");
    expect(outcome.failures).toEqual([]);
    expect(outcome.lines).toEqual(["译文0", "译文1", "译文2", "译文3"]);
  });
});
