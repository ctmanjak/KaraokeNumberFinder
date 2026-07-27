import { describe, expect, it, vi } from "vitest";
import {
  backfillSongIdentity,
  preflightSongIdentity,
  requireDisposableAdminSongDatabaseUrl
} from "./maintenance";

describe("song identity maintenance", () => {
  it("reports exact duplicates and system alias counts without user IDs", async () => {
    const query = vi.fn(async () => ({
      rows: [
        row("song_a", null, null, 1, 1, 1),
        row("song_b", "lemon", "artist", 1, 1, 0)
      ],
      rowCount: 2
    }));
    const report = await preflightSongIdentity({ query } as never);

    expect(report.release_blocked).toBe(true);
    expect(report.backfill_blocked).toBe(true);
    expect(report.exact_duplicate_groups).toHaveLength(1);
    expect(report.system_alias_violations).toEqual([
      { song_id: "song_b", alias_type: "artist", count: 0 }
    ]);
    expect(JSON.stringify(report)).not.toMatch(/user_id|email/iu);
    expect(query).toHaveBeenCalledOnce();
  });

  it("blocks backfill before mutation when preflight violations exist", async () => {
    const query = vi.fn(async () => ({
      rows: [row("song_a", null, null, 0, 1, 1)],
      rowCount: 1
    }));
    const result = await backfillSongIdentity({ query } as never);
    expect(result.applied).toBe(false);
    expect(query).toHaveBeenCalledOnce();
  });

  it("allows backfill to repair drift while keeping release blocked until it is repaired", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [row("song_a", null, null, 1, 1, 1)],
        rowCount: 1
      })
      .mockResolvedValueOnce({ rows: [], rowCount: null })
      .mockResolvedValueOnce({ rows: [], rowCount: null })
      .mockResolvedValueOnce({
        rows: [row("song_a", null, null, 1, 1, 1)],
        rowCount: 1
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "song_a",
            canonical_title: "Lemon",
            canonical_artist: "Artist"
          }
        ],
        rowCount: 1
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [row("song_a", "lemon", "artist", 1, 1, 1)],
        rowCount: 1
      })
      .mockResolvedValueOnce({ rows: [], rowCount: null });

    const result = await backfillSongIdentity({ query } as never);

    expect(result.before.backfill_blocked).toBe(false);
    expect(result.before.release_blocked).toBe(true);
    expect(result.updated_song_count).toBe(1);
    expect(result.after.release_blocked).toBe(false);
    expect(query.mock.calls.at(-1)?.[0]).toBe("COMMIT");
  });

  it("rolls back without updates when a violation appears after the initial preflight", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [row("song_a", null, null, 1, 1, 1)],
        rowCount: 1
      })
      .mockResolvedValueOnce({ rows: [], rowCount: null })
      .mockResolvedValueOnce({ rows: [], rowCount: null })
      .mockResolvedValueOnce({
        rows: [
          row("song_a", null, null, 1, 1, 1),
          row("song_b", null, null, 1, 1, 1)
        ],
        rowCount: 2
      })
      .mockResolvedValueOnce({ rows: [], rowCount: null });

    const result = await backfillSongIdentity({ query } as never);

    expect(result.applied).toBe(false);
    expect(result.before.exact_duplicate_groups).toHaveLength(1);
    expect(query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
    expect(
      query.mock.calls.some(([statement]) =>
        String(statement).includes("UPDATE songs")
      )
    ).toBe(false);
  });

  it("requires an explicitly confirmed local disposable database", () => {
    expect(
      requireDisposableAdminSongDatabaseUrl(
        "postgresql://localhost/knf_admin_song_test",
        "1"
      )
    ).toContain("knf_admin_song_test");
    expect(() =>
      requireDisposableAdminSongDatabaseUrl(
        "postgresql://db.example/production",
        "1"
      )
    ).toThrow(/disposable/iu);
  });
});

function row(
  id: string,
  normalizedTitle: string | null,
  normalizedArtist: string | null,
  canonicalCount: number,
  displayCount: number,
  artistCount: number
) {
  return {
    id,
    canonical_title: "Lemon",
    display_title: `Display ${id}`,
    canonical_artist: "Artist",
    normalized_canonical_title: normalizedTitle,
    normalized_canonical_artist: normalizedArtist,
    created_at: "2026-07-27T00:00:00.000000Z",
    updated_at: "2026-07-27T00:00:00.000000Z",
    alias_ids: [`alias_${id}`],
    entry_ids: [`entry_${id}`],
    favorite_count: "0",
    canonical_title_aliases: Array.from(
      { length: canonicalCount },
      () => "lemon"
    ),
    display_title_aliases: Array.from(
      { length: displayCount },
      () => `display${id.replaceAll("_", "")}`
    ),
    artist_aliases: Array.from({ length: artistCount }, () => "artist")
  };
}
