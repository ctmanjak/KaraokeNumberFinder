import { describe, expect, it, vi } from "vitest";

import { withAdminSongDuplicateMetrics } from "./metrics";

describe("administrator duplicate-check metrics", () => {
  it("records only non-identifying aggregate dimensions and survives sink failure", async () => {
    const writer = vi.fn(() => {
      throw new Error("sink unavailable");
    });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const clock = vi.fn().mockReturnValueOnce(10).mockReturnValueOnce(22.3456);
    const handler = withAdminSongDuplicateMetrics(
      async () =>
        Response.json(
          {
            error: {
              code: "DUPLICATE_CHECK_UNAVAILABLE",
              request_id: "must-not-enter-metric"
            }
          },
          { status: 503 }
        ),
      writer,
      clock
    );

    const response = await handler(
      new Request(
        "https://knf.example/api/admin/songs/duplicate-check?title=secret",
        { headers: { cookie: "session=secret" } }
      )
    );

    expect(response.status).toBe(503);
    expect(writer).toHaveBeenCalledWith({
      event: "admin_song.duplicate_check",
      route: "song_duplicate_check_api",
      http_status: 503,
      latency_ms: 12.346,
      timeout: true,
      in_flight: 1
    });
    const serialized = JSON.stringify(writer.mock.calls);
    expect(serialized).not.toMatch(
      /must-not-enter-metric|secret|request_id|actor|song_id|fingerprint/iu
    );
    expect(consoleError).toHaveBeenCalledOnce();
  });
});
