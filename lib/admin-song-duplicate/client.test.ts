import { describe, expect, it, vi } from "vitest";

import { checkAdminSongDuplicate } from "./client";

describe("administrator duplicate-check client", () => {
  it("rejects candidates without an evidence array", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({
        classification: "possible",
        candidates: [
          {
            id: "song-a",
            display_title: "Candidate",
            canonical_artist: "Artist",
            match_evidence: null
          }
        ]
      })
    );

    await expect(
      checkAdminSongDuplicate(
        {
          canonical_title: "Candidate",
          canonical_artist: "Artist"
        },
        fetcher
      )
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE", status: 200 });
  });
});
