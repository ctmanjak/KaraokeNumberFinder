import { describe, expect, it } from "vitest";
import { ADMIN_ALIAS_TYPES } from "../admin-song/types";
import {
  assertAliasCandidateRoleMapComplete,
  duplicateMatchStrength,
  normalizeDuplicateInput
} from "./match";
import { ALIAS_CANDIDATE_ROLE } from "./types";

describe("administrator duplicate matching contract", () => {
  it("maps every AliasType explicitly and excludes content", () => {
    expect(() =>
      assertAliasCandidateRoleMapComplete(
        ADMIN_ALIAS_TYPES,
        ALIAS_CANDIDATE_ROLE
      )
    ).not.toThrow();
    expect(ALIAS_CANDIDATE_ROLE.artist).toBe("artist");
    expect(ALIAS_CANDIDATE_ROLE.content).toBe("excluded");
  });

  it("uses exact for one code point and enables prefix/partial at two", () => {
    expect(duplicateMatchStrength("가", "가")).toBe("exact");
    expect(duplicateMatchStrength("가수", "가")).toBeNull();
    expect(duplicateMatchStrength("가나다", "가나")).toBe("prefix");
    expect(duplicateMatchStrength("앞가나뒤", "가나")).toBe("partial");
    expect(duplicateMatchStrength("가나", "앞가나뒤")).toBeNull();
  });

  it("deduplicates canonical and display title inputs after normalization", () => {
    expect(
      normalizeDuplicateInput({
        canonical_title: "Lemon",
        display_title: "ＬＥＭＯＮ!",
        canonical_artist: "Artist"
      }).titles
    ).toEqual([{ value: "lemon", inputField: "canonical_title" }]);
  });
});
