import { describe, expect, it } from "vitest";
import { extractTranslatedLinesWithNumbers, findAdjacentDuplicateSlots } from "@/app/lib/translation/contextTranslation";

// Regression tests for adjacency-aware merge guarding.
//
// When only part of a batch still needs translating (resume from per-line cache,
// blank pre-fills, an earlier retry), the engine compacts the pending slots into
// a contiguous 0..K-1 marker list. The extraction heuristics below then see a
// list whose neighbours are NOT necessarily adjacent in the source document.
//
// `adjacent[i]` (when supplied) says whether target i immediately follows
// target i-1 in the SOURCE document. A merge/duplication can only happen
// between physically adjacent lines, so a gap on a non-adjacent target must not
// discard the previous (correctly translated) target.

describe("extractTranslatedLinesWithNumbers adjacency-aware merge guard", () => {
  it("discards the predecessor when adjacent targets have a gap (default)", () => {
    // Targets srcA, srcB adjacent; model returned only srcA's tag.
    const out = extractTranslatedLinesWithNumbers("[TRANSLATE_0]transA[/TRANSLATE_0]", 2, ["srcA", "srcB"]);
    expect(out).toEqual(["", ""]);
  });

  it("keeps the predecessor when the next target is not physically adjacent", () => {
    // Targets srcA and srcC with a cached srcB between them: a missing srcC tag
    // is not evidence that the model merged A+C, so transA must survive.
    const out = extractTranslatedLinesWithNumbers("[TRANSLATE_0]transA[/TRANSLATE_0]", 2, ["srcA", "srcC"], undefined, [false, false]);
    expect(out).toEqual(["transA", ""]);
  });

  it("still discards when the supplied adjacency marks the pair as adjacent", () => {
    const out = extractTranslatedLinesWithNumbers("[TRANSLATE_0]transA[/TRANSLATE_0]", 2, ["srcA", "srcB"], undefined, [false, true]);
    expect(out).toEqual(["", ""]);
  });
});

describe("single-target 1-based marker recovery", () => {
  it("maps a lone [TRANSLATE_1] onto the only target", () => {
    // A lone target, yet the model numbered it 1 instead of 0. There is no
    // other line the tag could mean, so recover it instead of soft-filling the
    // line untranslated (the retry re-sends the same prompt and typically
    // reproduces the same 1-based answer).
    expect(extractTranslatedLinesWithNumbers("[TRANSLATE_1]transA[/TRANSLATE_1]", 1, ["srcA"])).toEqual(["transA"]);
  });

  it("prefers the requested 0-based tag when both are present", () => {
    expect(extractTranslatedLinesWithNumbers("[TRANSLATE_0]good[/TRANSLATE_0][TRANSLATE_1]bad[/TRANSLATE_1]", 1, ["srcA"])).toEqual(["good"]);
  });

  it("still rejects the multi-target 1..N signature", () => {
    expect(extractTranslatedLinesWithNumbers("[TRANSLATE_1]a[/TRANSLATE_1][TRANSLATE_2]b[/TRANSLATE_2]", 2, ["s1", "s2"])).toEqual(["", ""]);
  });
});

describe("findAdjacentDuplicateSlots adjacency", () => {
  it("flags an equal pair whose sources differ (default)", () => {
    expect(findAdjacentDuplicateSlots(["same", "same"], ["a", "b"])).toEqual([0, 1]);
  });

  it("ignores an equal pair that is not physically adjacent", () => {
    expect(findAdjacentDuplicateSlots(["same", "same"], ["a", "b"], [false, false])).toEqual([]);
  });

  it("flags an equal physically adjacent pair", () => {
    expect(findAdjacentDuplicateSlots(["same", "same"], ["a", "b"], [false, true])).toEqual([0, 1]);
  });
});
