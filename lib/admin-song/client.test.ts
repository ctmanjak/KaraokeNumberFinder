import { describe, expect, it, vi } from "vitest";

import { fetchAdminSongOptions } from "./client";

describe("administrator song client errors", () => {
  it("preserves the response payload and retry metadata", async () => {
    const payload = {
      error: {
        code: "RATE_LIMITED",
        message: "Too many requests.",
        request_id: "request-rate-limit"
      }
    };
    const fetcher = vi.fn(async () =>
      Response.json(payload, {
        status: 429,
        headers: { "retry-after": "30" }
      })
    );

    await expect(fetchAdminSongOptions(fetcher)).rejects.toMatchObject({
      code: "RATE_LIMITED",
      status: 429,
      payload,
      retryAfter: "30"
    });
  });
});
