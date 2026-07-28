import { describe, expect, it } from "vitest";

import { isNormalizedIdentityUniqueViolation } from "./prisma-error";

describe("normalized song identity unique errors", () => {
  it.each([
    {
      code: "P2002",
      meta: { constraint: "songs_normalized_canonical_title_artist_key" }
    },
    {
      code: "P2002",
      meta: {
        target: ["normalizedCanonicalTitle", "normalizedCanonicalArtist"]
      }
    },
    {
      code: "P2002",
      meta: {
        cause: {
          constraint: {
            fields: [
              "normalized_canonical_title",
              "normalized_canonical_artist"
            ]
          }
        }
      }
    }
  ])("recognizes adapter-specific identity metadata", (error) => {
    expect(isNormalizedIdentityUniqueViolation(error)).toBe(true);
  });

  it("does not relabel an unrelated unique conflict", () => {
    expect(
      isNormalizedIdentityUniqueViolation({
        code: "P2002",
        meta: { target: ["songId", "providerId"] }
      })
    ).toBe(false);
  });
});
