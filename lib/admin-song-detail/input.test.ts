import { describe, expect, it } from "vitest";
import { parseAdminSongPatchInput } from "./input";

describe("administrator song PATCH input", () => {
  it("preserves omit/null/value distinctions in an exact aggregate DTO", () => {
    const parsed = parseAdminSongPatchInput(validPatch());
    expect(parsed.song).not.toHaveProperty("source_url");
    expect(parsed.karaoke_entries[0]).toMatchObject({
      id: "entry_1",
      last_verified_at: null,
      source_url: null
    });
  });

  it.each([
    {
      song: {
        ...validPatch().song,
        normalized_canonical_title: "forged"
      }
    },
    {
      aliases: [
        {
          alias: "Lemon",
          language: "ja",
          alias_type: "canonical_title"
        }
      ]
    },
    {
      possible_duplicate_acknowledged_song_ids: ["song_a", "song_a"]
    },
    {
      aliases: Array.from({ length: 31 }, () => ({
        alias: "Alias",
        language: "en",
        alias_type: "english_title"
      }))
    }
  ])("rejects normalized/system/duplicate/oversized input", (patch) => {
    expect(() =>
      parseAdminSongPatchInput({ ...validPatch(), ...patch })
    ).toThrowError(
      expect.objectContaining({ code: "VALIDATION_ERROR", status: 422 })
    );
  });

  it("reports the complete path of a forged normalized Song field", () => {
    try {
      parseAdminSongPatchInput({
        ...validPatch(),
        song: {
          ...validPatch().song,
          normalized_canonical_title: "forged"
        }
      });
      throw new Error("Expected validation failure.");
    } catch (error) {
      expect(error).toMatchObject({
        code: "VALIDATION_ERROR",
        details: {
          issues: [
            expect.objectContaining({
              path: "song.normalized_canonical_title"
            })
          ]
        }
      });
    }
  });
});

function validPatch() {
  return {
    expected_updated_at: "2026-07-27T00:00:00.000Z",
    song: {
      original_language: "ja",
      canonical_title: "Lemon",
      display_title: "레몬",
      canonical_artist: "米津玄師",
      release_year: 2018,
      tie_in: null,
      source_name: "Official",
      verification_note: null
    },
    aliases: [],
    karaoke_entries: [
      {
        id: "entry_1",
        provider_id: "tj",
        karaoke_number: "",
        version_info: "",
        availability_status: "unknown",
        last_verified_at: null,
        source_name: "TJ",
        source_url: null,
        verification_note: null
      }
    ],
    possible_duplicate_acknowledged_song_ids: []
  };
}
