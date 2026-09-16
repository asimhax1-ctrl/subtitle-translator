import { describe, expect, it } from "vitest";
import { translateLines, type PipelineCache, type PipelineRuntimeConfig } from "@/app/lib/translation/pipeline";
import { generateCacheKey, generateCacheSuffix } from "@/app/lib/translation/cache";
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

describe("context batch marker targeting", () => {
  it("targets only untranslated slots in a partially cached batch", async () => {
    const lines = ["A", "B", "C", "D"];
    const config = makeConfig(lines.length);
    const cache = makeCache();
    const suffix = suffixFor(config);
    // B and D are already translated (resume from per-line cache).
    cache.store.set(generateCacheKey("B", suffix), "缓存B");
    cache.store.set(generateCacheKey("D", suffix), "缓存D");

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
    cache.store.set(generateCacheKey("L5", suffix), "缓存L5");

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
