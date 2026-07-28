import { describe, expect, it, vi } from "vitest";
import { createAdminSongCreateAuditCompletion } from "./audit";

describe("administrator song create audit", () => {
  it("records one redacted committed event with actual counts", async () => {
    const writer = vi.fn();
    const completion = createAdminSongCreateAuditCompletion(
      writer,
      () => new Date("2026-07-28T01:02:03.000Z")
    );

    await completion({
      requestId: "request-create",
      actorUserId: "actor-internal",
      response: Response.json(
        {
          song: {
            id: "song-created",
            display_title: "must-not-log",
            canonical_artist: "must-not-log"
          },
          created_counts: {
            songs: 1,
            administrator_aliases: 2,
            karaoke_entries: 3
          }
        },
        { status: 201 }
      )
    });

    expect(writer).toHaveBeenCalledOnce();
    expect(writer).toHaveBeenCalledWith({
      event: "admin_song.create",
      occurred_at: "2026-07-28T01:02:03.000Z",
      request_id: "request-create",
      actor_user_id: "actor-internal",
      target_song_id: "song-created",
      outcome: "accepted",
      http_status: 201,
      created_counts: {
        songs: 1,
        administrator_aliases: 2,
        karaoke_entries: 3
      }
    });
    expect(JSON.stringify(writer.mock.calls[0][0])).not.toMatch(
      /must-not-log|canonical_artist|display_title|request_body|email|token|csrf/iu
    );
  });

  it.each([
    [403, "ADMIN_CATALOG_NOT_ENABLED", "rejected"],
    [409, "DUPLICATE_SONG", "rejected"],
    [422, "VALIDATION_ERROR", "rejected"],
    [503, "DUPLICATE_CHECK_UNAVAILABLE", "failed"]
  ] as const)(
    "records %s %s once without target data",
    async (status, code, outcome) => {
      const writer = vi.fn();
      const completion = createAdminSongCreateAuditCompletion(writer);

      await completion({
        requestId: "request-failed",
        actorUserId: "actor-internal",
        response: Response.json(
          {
            error: {
              code,
              message: "must-not-log",
              details: { request_body: "must-not-log" }
            }
          },
          { status }
        )
      });

      expect(writer).toHaveBeenCalledOnce();
      expect(writer.mock.calls[0][0]).toMatchObject({
        event: "admin_song.create",
        outcome,
        http_status: status,
        error_code: code,
        created_counts: {
          songs: 0,
          administrator_aliases: 0,
          karaoke_entries: 0
        }
      });
      expect(writer.mock.calls[0][0]).not.toHaveProperty("target_song_id");
      expect(JSON.stringify(writer.mock.calls[0][0])).not.toContain(
        "must-not-log"
      );
    }
  );

  it("does not let an audit sink failure change completion", async () => {
    const completion = createAdminSongCreateAuditCompletion(() => {
      throw new Error("sink");
    });

    await expect(
      completion({
        requestId: "request-create",
        response: Response.json({
          song: { id: "song-created" },
          created_counts: {
            songs: 1,
            administrator_aliases: 0,
            karaoke_entries: 1
          }
        })
      })
    ).resolves.toBeUndefined();
  });
});
