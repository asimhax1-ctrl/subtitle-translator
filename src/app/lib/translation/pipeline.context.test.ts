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

  it("keeps a correct translation when a NON-adjacent pending line's tag is omitted", async () => {
    // A and C are pending with B cached between them. The model answers A but
    // omits C's tag. Because A and C are not physically adjacent, the omission
    // must not discard A's (correct) translation — the merge guard only applies
    // to adjacent source lines.
    const lines = ["A", "B", "C"];
    const config = makeConfig(lines.length);
    const cache = makeCache();
    cache.store.set(generateCacheKey("B", suffixFor(config)), "缓存B");

    const requests: string[] = [];
    let call = 0;
    const translate = async (params: TranslateTextParams): Promise<string> => {
      requests.push(params.text);
      if (call++ === 0) return "[TRANSLATE_0]firstA[/TRANSLATE_0]"; // omits ordinal 1
      const ordinals = [...params.text.matchAll(TRANSLATE_MARKER_RE)].map((m) => Number(m[1]));
      return ordinals.map((n) => `[TRANSLATE_${n}]later${n}[/TRANSLATE_${n}]`).join("\n");
    };

    const outcome = await translateLines(lines, config, { cache, translate }, "subtitle", {});

    expect(outcome.failures).toEqual([]);
    // firstA survived the gap; only C had to be re-translated.
    expect(outcome.lines).toEqual(["firstA", "缓存B", "later0"]);
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

  it("keeps a correct translation when a later, non-adjacent target is omitted", async () => {
    // A and C are pending with cached B between them. The model omits C's tag.
    // Because A and C are not physically adjacent, the missing tag is an
    // omission, not a merge — A's correct translation must survive (and only
    // C should be retried).
    const lines = ["A", "B", "C"];
    const config = makeConfig(lines.length);
    const cache = makeCache();
    const suffix = suffixFor(config);
    cache.store.set(generateCacheKey("B", suffix), "缓存B");

    const requests: string[] = [];
    const translate = async (params: TranslateTextParams): Promise<string> => {
      requests.push(params.text);
      if (params.text.includes("[TRANSLATE_0]A[/TRANSLATE_0]") && params.text.includes("[TRANSLATE_1]C[/TRANSLATE_1]")) {
        return "[TRANSLATE_0]译文A[/TRANSLATE_0]";
      }
      return "[TRANSLATE_0]译文C[/TRANSLATE_0]";
    };

    const outcome = await translateLines(lines, config, { cache, translate }, "subtitle", {});

    expect(outcome.lines).toEqual(["译文A", "缓存B", "译文C"]);
    expect(outcome.failures).toEqual([]);
    expect(requests).toHaveLength(2);
  });

  it("does not re-translate two equal non-adjacent pending lines as a merge", async () => {
    const lines = ["A", "B", "C"];
    const config = makeConfig(lines.length);
    const cache = makeCache();
    const suffix = suffixFor(config);
    cache.store.set(generateCacheKey("B", suffix), "缓存B");

    const requests: string[] = [];
    const translate = async (params: TranslateTextParams): Promise<string> => {
      requests.push(params.text);
      return "[TRANSLATE_0]一样[/TRANSLATE_0]\n[TRANSLATE_1]一样[/TRANSLATE_1]";
    };

    const outcome = await translateLines(lines, config, { cache, translate }, "subtitle", {});

    expect(outcome.lines).toEqual(["一样", "缓存B", "一样"]);
    expect(requests).toHaveLength(1);
  });
});
