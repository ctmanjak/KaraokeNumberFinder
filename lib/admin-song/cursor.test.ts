import { describe, expect, it } from "vitest";

import {
  decodeAdminSongCursor,
  encodeAdminSongCursor,
  InvalidAdminSongCursorError
} from "./cursor";

describe("administrator song cursor", () => {
  it("round-trips the stable updated_at DESC, id ASC key opaquely", () => {
    const key = {
      updatedAt: "2026-07-26T01:02:03.456789Z",
      id: "song-a"
    };
    const cursor = encodeAdminSongCursor(key, "normalizedquery");

    expect(cursor).not.toContain("song-a");
    expect(decodeAdminSongCursor(cursor, "normalizedquery")).toEqual(key);
  });

  it("rejects malformed, changed, and cross-query cursors", () => {
    const cursor = encodeAdminSongCursor(
      {
        updatedAt: "2026-07-26T01:02:03.456789Z",
        id: "song-a"
      },
      "first"
    );

    for (const invalid of ["", "not+base64", `${cursor}changed`]) {
      expect(() => decodeAdminSongCursor(invalid, "first")).toThrow(
        InvalidAdminSongCursorError
      );
    }
    expect(() => decodeAdminSongCursor(cursor, "second")).toThrow(
      InvalidAdminSongCursorError
    );
    expect(() =>
      encodeAdminSongCursor(
        { updatedAt: "2026-07-26T01:02:03.456Z", id: "song-a" },
        "first"
      )
    ).toThrow(InvalidAdminSongCursorError);
  });
});
