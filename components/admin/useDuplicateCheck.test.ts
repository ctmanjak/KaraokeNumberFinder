import { describe, expect, it } from "vitest";

import { duplicateInputError } from "./useDuplicateCheck";

describe("administrator duplicate-check input state", () => {
  const valid = {
    originalLanguage: "ja",
    canonicalTitle: "Lemon",
    displayTitle: "레몬",
    canonicalArtist: "米津玄師"
  };

  it("distinguishes normalization and length errors from idle input", () => {
    expect(duplicateInputError(valid)).toBeNull();
    expect(duplicateInputError({ ...valid, canonicalTitle: "---" })).toContain(
      "검색 가능한 문자"
    );
    expect(
      duplicateInputError({ ...valid, canonicalArtist: "a".repeat(513) })
    ).toBe("가수는 512자 이하로 입력해 주세요.");
  });
});
