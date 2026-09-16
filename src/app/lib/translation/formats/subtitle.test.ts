import { expect, test } from "vitest";
import { assembleSubtitleOutput, ASS_STYLE_PRESETS, filterSubLines } from "./subtitle";

test("LRC metadata after lyrics is preserved and never translated", () => {
  const lines = ["[ar:Artist]", "[00:01.00]Hello", "[offset:-250]", "[TI:Title]", "[00:02.00][00:03.00]World"];
  const extracted = filterSubLines(lines, "lrc");
  expect(extracted.contentLines).toEqual(["Hello", "World"]);
  expect(extracted.contentIndices).toEqual([1, 4]);

  const output = assembleSubtitleOutput({
    lines,
    ...extracted,
    translatedLines: ["مرحبا", "العالم"],
    fileType: "lrc",
    tagMaps: [],
    isBilingual: false,
    isOriginalFirst: true,
    bilingualFormat: "srt",
    assNativeRebuild: false,
    assStyle: ASS_STYLE_PRESETS.default,
    sourceLanguage: "en",
    exportLang: "ar",
  });
  expect(output).toBe("[ar:Artist]\n[00:01.00] مرحبا\n[offset:-250]\n[TI:Title]\n[00:02.00][00:03.00] العالم");
});

test("ASS without a Format header preserves commas inside every dialogue", () => {
  const lines = [
    "[Script Info]",
    "[Events]",
    "Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,Hello, world",
    "Dialogue: 0,0:00:03.00,0:00:04.00,Default,,0,0,0,,Yes, please, now",
  ];
  const extracted = filterSubLines(lines, "ass");
  expect(extracted.assContentStartIndex).toBe(9);
  expect(extracted.contentLines).toEqual(["Hello, world", "Yes, please, now"]);
});

test("an explicit ASS Format header still determines the text column", () => {
  const lines = ["[Events]", "Format: Start, End, Text", "Dialogue: 0:00:01.00,0:00:02.00,Hello, world"];
  const extracted = filterSubLines(lines, "ass");
  expect(extracted.assContentStartIndex).toBe(2);
  expect(extracted.contentLines).toEqual(["Hello, world"]);
});

test("LRC numeric lyrics and timed text resembling metadata remain translatable", () => {
  const extracted = filterSubLines(["[00:01.00]3", "[00:02.00][ti:Say this]", "[00:03.00]"], "lrc");
  expect(extracted.contentLines).toEqual(["3", "[ti:Say this]"]);
});
