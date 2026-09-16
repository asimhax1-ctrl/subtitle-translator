import { describe, expect, it } from "vitest";
import { resolveBilingualFonts, scriptOf } from "@/app/lib/translation/formats/subtitle";

// LANG_SCRIPT + resolveBilingualFonts feed the ASS bilingual header: a language
// missing from the map falls back to "latin", and when the other half is CJK
// the resolver can then hand Arabic/Hebrew script to a CJK-only font (no
// glyphs → tofu on export). Regression guard for subtitle-translator#62.

describe("scriptOf classification", () => {
  it("classifies every Arabic-script language, including Hausa", () => {
    for (const code of ["ar", "fa", "ur", "ps", "prs", "ckb", "ug", "ha"]) {
      expect(scriptOf(code), code).toBe("arabic");
    }
  });

  it("classifies Hebrew-script languages as hebrew", () => {
    expect(scriptOf("he")).toBe("hebrew");
    expect(scriptOf("yi")).toBe("hebrew");
  });

  it("falls back to latin for unlisted languages", () => {
    expect(scriptOf("en")).toBe("latin");
    expect(scriptOf("ru")).toBe("latin");
  });
});

describe("resolveBilingualFonts", () => {
  it("does not assign a CJK-only font to an Arabic-script target", () => {
    expect(resolveBilingualFonts("zh", "ha", "")).toEqual({ translation: "Arial", original: "Microsoft YaHei" });
  });

  it("keeps the explicit font when the user sets one", () => {
    expect(resolveBilingualFonts("zh", "ha", "Noto Sans Arabic")).toEqual({ translation: "Noto Sans Arabic", original: "Noto Sans Arabic" });
  });
});
