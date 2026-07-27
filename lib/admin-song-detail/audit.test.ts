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
});
