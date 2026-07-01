import { describe, expect, it } from "vitest";

import {
  buildAliasSearchFields,
  canUseHangulChosungSearch,
  extractHangulChosung,
  normalizeSearchText
} from "./normalize";

describe("normalizeSearchText", () => {
  it.each([
    ["ＡＢＣ１２３", "abc123"],
    ["Kimi no", "kimino"],
    ["Title (TV size)", "titletvsize"],
    ["A-B_C・D.E'F!?", "abcdef"],
    [" 잔혹한 천사의 테제 ", "잔혹한천사의테제"]
  ])("normalizes %s", (input, expected) => {
    expect(normalizeSearchText(input)).toBe(expected);
  });

  it("removes bracket characters while preserving inner text", () => {
    expect(normalizeSearchText("[Title] {TV size}")).toBe("titletvsize");
  });
});

describe("extractHangulChosung", () => {
  it("extracts initials from Hangul syllables", () => {
    expect(extractHangulChosung("잔혹한 천사의 테제")).toBe("ㅈㅎㅎㅊㅅㅇㅌㅈ");
  });

  it("returns an empty string when the input has no Hangul syllables", () => {
    expect(extractHangulChosung("Zankoku na Tenshi no Thesis")).toBe("");
  });

  it("includes only Hangul syllables from mixed input", () => {
    expect(extractHangulChosung("A잔B혹C한 123 Thesis")).toBe("ㅈㅎㅎ");
  });

  it("does not decompose existing Hangul jamo", () => {
    expect(extractHangulChosung("ㅈㅎㅎ")).toBe("");
  });
});

describe("buildAliasSearchFields", () => {
  it("builds seed alias search fields from one source alias", () => {
    expect(buildAliasSearchFields(" 잔혹한 천사의 테제 ")).toEqual({
      normalizedAlias: "잔혹한천사의테제",
      chosungAlias: "ㅈㅎㅎㅊㅅㅇㅌㅈ"
    });
  });

  it("keeps chosungAlias empty for non-Hangul aliases", () => {
    expect(buildAliasSearchFields("Zankoku na Tenshi no Thesis")).toEqual({
      normalizedAlias: "zankokunatenshinothesis",
      chosungAlias: ""
    });
  });
});

describe("canUseHangulChosungSearch", () => {
  it("allows chosung search from two initials", () => {
    expect(canUseHangulChosungSearch("ㅈㅎ")).toBe(true);
  });

  it("rejects one-initial chosung search", () => {
    expect(canUseHangulChosungSearch("ㅈ")).toBe(false);
  });
});
