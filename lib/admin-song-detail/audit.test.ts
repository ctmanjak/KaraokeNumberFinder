import { describe, expect, it, vi } from "vitest";
import { createAdminSongUpdateAuditCompletion } from "./audit";

describe("administrator song update audit", () => {
  it("writes exactly one redacted success event with applied counts", async () => {
    const writer = vi.fn();
    const completion = createAdminSongUpdateAuditCompletion(
      "song_1",
      writer,
      () => new Date("2026-07-27T01:02:03.000Z")
    );
    await completion({
      requestId: "request-1",
      actorUserId: "actor-1",
      response: Response.json({
        detail: {
          song: { canonical_title: "must-not-enter-audit" }
        },
        change_counts: {
          song_fields: 1,
          aliases_added: 1,
          aliases_updated: 0,
          aliases_deleted: 0,
          karaoke_entries_added: 0,
          karaoke_entries_updated: 1
        }
      })
    });

    expect(writer).toHaveBeenCalledOnce();
    expect(writer).toHaveBeenCalledWith({
      event: "admin_song.update",
      occurred_at: "2026-07-27T01:02:03.000Z",
      request_id: "request-1",
      actor_user_id: "actor-1",
      target_song_id: "song_1",
      outcome: "accepted",
      http_status: 200,
      change_counts: {
        song_fields: 1,
        aliases_added: 1,
        aliases_updated: 0,
        aliases_deleted: 0,
        karaoke_entries_added: 0,
        karaoke_entries_updated: 1
      }
    });
    expect(JSON.stringify(writer.mock.calls)).not.toContain(
      "must-not-enter-audit"
    );
  });

  it.each([
    [422, "VALIDATION_ERROR", "rejected"],
    [503, "DATABASE_TIMEOUT", "failed"]
  ] as const)(
    "records %i responses with %s as %s failures without response internals",
    async (status, errorCode, outcome) => {
      const writer = vi.fn();
      const completion = createAdminSongUpdateAuditCompletion("song_1", writer);

      await completion({
        requestId: `request-${status}`,
        actorUserId: "actor-1",
        response: Response.json(
          {
            error: {
              code: errorCode,
              message: "must-not-enter-audit"
            }
          },
          { status }
        )
      });

      expect(writer).toHaveBeenCalledOnce();
      expect(writer).toHaveBeenCalledWith(
        expect.objectContaining({
          outcome,
          http_status: status,
          error_code: errorCode
        })
      );
      expect(JSON.stringify(writer.mock.calls)).not.toContain(
        "must-not-enter-audit"
      );
    }
  );

  it("swallows audit writer failures after one write attempt", async () => {
    const writer = vi.fn(() => {
      throw new Error("sink unavailable");
    });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const completion = createAdminSongUpdateAuditCompletion("song_1", writer);

    await expect(
      completion({
        requestId: "request-writer-failure",
        response: new Response(null, { status: 500 })
      })
    ).resolves.toBeUndefined();
    expect(writer).toHaveBeenCalledOnce();
    expect(consoleError).toHaveBeenCalledOnce();
    consoleError.mockRestore();
  });
});
