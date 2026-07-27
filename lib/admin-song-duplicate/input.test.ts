import { describe, expect, it } from "vitest";
import { parseDuplicateCheckInput } from "./input";

describe("duplicate-check exact input", () => {
  it("accepts a validated current-song exclusion ID", () => {
    expect(
      parseDuplicateCheckInput({
        canonical_title: " Lemon ",
        display_title: "레몬",
        canonical_artist: "Artist",
        exclude_song_id: "song_001"
      })
    ).toEqual({
      canonical_title: "Lemon",
      display_title: "레몬",
      canonical_artist: "Artist",
      exclude_song_id: "song_001"
    });
  });

  it.each([
    { canonical_title: "Lemon", canonical_artist: "Artist", actor_id: "x" },
    {
      canonical_title: "Lemon",
      canonical_artist: "Artist",
      normalized_canonical_title: "forged"
    },
    { canonical_title: "---", canonical_artist: "Artist" },
    {
      canonical_title: "Lemon",
      canonical_artist: "Artist",
      exclude_song_id: "../unsafe"
    }
  ])("rejects unknown, normalized, empty and unsafe fields", (input) => {
    expect(() => parseDuplicateCheckInput(input)).toThrowError(
      expect.objectContaining({ code: "VALIDATION_ERROR" })
    );
  });
});
