import { describe, expect, it } from "vitest";

import { encodeAdminSongCursor } from "./cursor";
import {
  DEFAULT_ADMIN_SONG_LIST_LIMIT,
  InvalidAdminSongListQueryError,
  MAX_ADMIN_SONG_LIST_LIMIT,
  parseAdminSongListQuery,
  parseAdminSongListResponse
} from "./list-contract";

describe("administrator song list contract", () => {
  it("treats a missing or blank query as the full list with limit 20", () => {
    expect(parseAdminSongListQuery(new URLSearchParams())).toMatchObject({
      query: null,
      normalizedQuery: null,
      cursor: null,
      limit: DEFAULT_ADMIN_SONG_LIST_LIMIT
    });
    expect(
      parseAdminSongListQuery(new URLSearchParams({ query: " \t " }))
    ).toMatchObject({ query: null, normalizedQuery: null });
  });

  it("normalizes full-width text, case, whitespace, and weak symbols", () => {
    expect(
      parseAdminSongListQuery(
        new URLSearchParams({ query: " Ａ-B_c・D.E'F!? " })
      )
    ).toMatchObject({
      query: "Ａ-B_c・D.E'F!?",
      normalizedQuery: "abcdef"
    });
  });

  it("accepts the maximum limit and rejects invalid query inputs", () => {
    expect(
      parseAdminSongListQuery(
        new URLSearchParams({ limit: String(MAX_ADMIN_SONG_LIST_LIMIT) })
      ).limit
    ).toBe(50);

    for (const value of ["0", "51", "1.5", "-1", "01", "NaN"]) {
      expect(() =>
        parseAdminSongListQuery(new URLSearchParams({ limit: value }))
      ).toThrow(InvalidAdminSongListQueryError);
    }
    for (const params of [
      new URLSearchParams({ query: "!!!" }),
      new URLSearchParams({ unknown: "value" }),
      new URLSearchParams("limit=20&limit=21"),
      new URLSearchParams({ cursor: "invalid" })
    ]) {
      expect(() => parseAdminSongListQuery(params)).toThrow(
        InvalidAdminSongListQueryError
      );
    }
  });

  it("binds a valid cursor to the normalized query", () => {
    const cursor = encodeAdminSongCursor(
      { updatedAt: "2026-07-26T00:00:00.000123Z", id: "song-a" },
      "query"
    );
    expect(
      parseAdminSongListQuery(new URLSearchParams({ query: "Query", cursor }))
        .cursor
    ).toEqual({
      updatedAt: "2026-07-26T00:00:00.000123Z",
      id: "song-a"
    });
    expect(() =>
      parseAdminSongListQuery(
        new URLSearchParams({ query: "Different", cursor })
      )
    ).toThrow(InvalidAdminSongListQueryError);
  });

  it("accepts only the explicit redacted DTO projection", () => {
    const valid = {
      items: [
        {
          id: "song-a",
          original_language: "ja",
          canonical_title: "原題",
          display_title: "표시 제목",
          canonical_artist: "Artist",
          provider_summary: [
            {
              provider_id: "tj",
              provider_name: "TJ",
              karaoke_number: "12345",
              version_info: "",
              availability_status: "available"
            }
          ],
          updated_at: "2026-07-26T00:00:00.000Z"
        }
      ],
      next_cursor: null
    };
    expect(parseAdminSongListResponse(valid)).toEqual(valid);

    for (const secret of [
      "source_name",
      "source_url",
      "verification_note",
      "verified_by",
      "email"
    ]) {
      expect(() =>
        parseAdminSongListResponse({
          ...valid,
          items: [{ ...valid.items[0], [secret]: "must-not-leak" }]
        })
      ).toThrow(TypeError);
    }
  });
});
