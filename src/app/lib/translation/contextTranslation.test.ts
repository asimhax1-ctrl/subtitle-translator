import { describe, expect, it, test } from "vitest";
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

  it("prefers the requested zero-based tag even when the one-based tag arrives first", () => {
    expect(extractTranslatedLinesWithNumbers("[TRANSLATE_1]bad[/TRANSLATE_1][TRANSLATE_0]good[/TRANSLATE_0]", 1, ["srcA"])).toEqual(["good"]);
  });

  it("rejects conflicting duplicate one-based recovery markers", () => {
    expect(extractTranslatedLinesWithNumbers("[TRANSLATE_1]first[/TRANSLATE_1][TRANSLATE_1]second[/TRANSLATE_1]", 1, ["srcA"])).toEqual([""]);
  });

  it("accepts identical duplicate one-based recovery markers", () => {
    expect(extractTranslatedLinesWithNumbers("[TRANSLATE_1]same[/TRANSLATE_1][TRANSLATE_1]same[/TRANSLATE_1]", 1, ["srcA"])).toEqual(["same"]);
  });

  it("rejects nested markers inside a one-based recovery marker", () => {
    expect(extractTranslatedLinesWithNumbers("[TRANSLATE_1]Hello [TRANSLATE_2]world[/TRANSLATE_2][/TRANSLATE_1]", 1, ["srcA"])).toEqual([""]);
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

test("non-adjacent omissions preserve predecessors while echo slots are reported independently", () => {
  const echoSlots = new Set<number>();
  const response = "[TRANSLATE_0]translatedA[/TRANSLATE_0][TRANSLATE_2]contextEcho[/TRANSLATE_2]";
  const out = extractTranslatedLinesWithNumbers(response, 3, ["srcA", "srcC", "srcE"], ["srcA", "srcC", "srcE", "contextEcho"], [false, false, false], echoSlots);
  expect(out).toEqual(["translatedA", "", ""]);
  expect([...echoSlots]).toEqual([2]);
});

test("conflicting duplicate markers are rejected instead of selecting the first answer", () => {
  const response = "[TRANSLATE_0]مرحبا[/TRANSLATE_0]\n[TRANSLATE_0]وداعا[/TRANSLATE_0]\n[TRANSLATE_1]العالم[/TRANSLATE_1]";
  expect(extractTranslatedLinesWithNumbers(response, 2)).toEqual(["", "العالم"]);
});

test("identical duplicate markers are harmless", () => {
  const response = "[TRANSLATE_0]مرحبا[/TRANSLATE_0]\n[TRANSLATE_0]مرحبا[/TRANSLATE_0]";
  expect(extractTranslatedLinesWithNumbers(response, 1)).toEqual(["مرحبا"]);
});

test("nested numbered markers cannot be cleaned into a successful merged slot", () => {
  const response = "[TRANSLATE_0]Hello [TRANSLATE_1]world[/TRANSLATE_1][/TRANSLATE_0]";
  expect(extractTranslatedLinesWithNumbers(response, 1)).toEqual([""]);
});

test("reordered well-formed markers and supported closing typos retain alignment", () => {
  const response = "[TRANSLATE_1]العالم[/TRANSLTranslate_1]\n[TRANSLATE_0]مرحبا[/TRANSLATE_0]";
  expect(extractTranslatedLinesWithNumbers(response, 2)).toEqual(["مرحبا", "العالم"]);
});
