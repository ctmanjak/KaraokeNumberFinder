import { describe, expect, it } from "vitest";
import { normalizeSongIdentity } from "./normalize";

describe("normalizeSongIdentity", () => {
  it("reuses public search normalization for whitespace, case, full-width and punctuation", () => {
    expect(
      normalizeSongIdentity({
        canonical_title: "  Ｌｅｍｏｎ！ ",
        canonical_artist: "米 津-玄師"
      })
    ).toEqual({
      normalizedCanonicalTitle: "lemon",
      normalizedCanonicalArtist: "米津玄師"
    });
  });

  it("reports the raw field whose normalized identity becomes empty", () => {
    expect(() =>
      normalizeSongIdentity({
        canonical_title: "---",
        canonical_artist: "Artist"
      })
    ).toThrowError(
      expect.objectContaining({
        field: "canonical_title",
        reason: "empty_after_normalization"
      })
    );
  });
});
