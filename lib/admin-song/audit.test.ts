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
      outcome: "success",
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
        actor_user_id: "actor-internal",
        target_song_id: null,
        outcome,
        http_status: status,
        error_code: code,
        created_counts: {
          songs: 0,
          administrator_aliases: 0,
          karaoke_entries: 0
        }
      });
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

  it("uses explicit null identifiers before authentication or target creation", async () => {
    const writer = vi.fn();
    const completion = createAdminSongCreateAuditCompletion(writer);

    await completion({
      requestId: "request-guest",
      response: Response.json(
        {
          error: {
            code: "UNAUTHENTICATED",
            message: "Authentication required.",
            request_id: "request-guest"
          }
        },
        { status: 401 }
      )
    });

    expect(writer).toHaveBeenCalledWith(
      expect.objectContaining({
        request_id: "request-guest",
        actor_user_id: null,
        target_song_id: null,
        outcome: "rejected"
      })
    );
  });

  it("redacts the actor identifier from the default console audit", async () => {
    const consoleInfo = vi
      .spyOn(console, "info")
      .mockImplementation(() => undefined);
    const completion = createAdminSongCreateAuditCompletion();

    await completion({
      requestId: "request-default-create",
      actorUserId: "sensitive-actor-id",
      response: Response.json(
        {
          song: { id: "song-created" },
          created_counts: {
            songs: 1,
            administrator_aliases: 0,
            karaoke_entries: 1
          }
        },
        { status: 201 }
      )
    });

    expect(consoleInfo).toHaveBeenCalledWith(
      "[admin-song] Song create audit.",
      expect.objectContaining({ actor_user_id: "[redacted]" })
    );
    expect(JSON.stringify(consoleInfo.mock.calls)).not.toContain(
      "sensitive-actor-id"
    );
    consoleInfo.mockRestore();
  });

  it("warns instead of silently trusting malformed success counts", async () => {
    const writer = vi.fn();
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const completion = createAdminSongCreateAuditCompletion(writer);

    await completion({
      requestId: "request-malformed-counts",
      response: Response.json({
        song: { id: "song-created" },
        created_counts: {
          songs: 0,
          administrator_aliases: "invalid",
          karaoke_entries: 1
        }
      })
    });

    expect(consoleError).toHaveBeenCalledWith(
      "[admin-song] Successful create audit had invalid counts."
    );
    expect(writer).toHaveBeenCalledWith(
      expect.objectContaining({ created_counts: ZERO_EXPECTED_COUNTS })
    );
  });
});

const ZERO_EXPECTED_COUNTS = {
  songs: 0,
  administrator_aliases: 0,
  karaoke_entries: 0
};
