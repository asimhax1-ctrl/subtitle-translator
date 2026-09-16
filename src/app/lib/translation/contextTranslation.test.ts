import { expect, test } from "vitest";
import { extractTranslatedLinesWithNumbers } from "./contextTranslation";

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
