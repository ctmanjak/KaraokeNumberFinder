import { describe, expect, it, vi } from "vitest";

import {
  createPersonalizationHandler,
  type RequireSession
} from "../personalization";
import { createUserDataMergePostHandler } from "./route-handler";
import type { UserDataMergeService } from "./service";

const ORIGIN = "https://knf.example";
const MERGE_ID = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";

describe("user data merge route handler", () => {
  it("accepts a recent-search-only request and sources user id from session", async () => {
    const service = serviceStub();
    const response = await protectedHandler(
      createUserDataMergePostHandler(service)
    )(
      mutationRequest({
        merge_id: MERGE_ID,
        recent_searches: [
          { query: " Hello ", searched_at: "2026-07-20T01:00:00.000Z" }
        ]
      })
    );

    expect(response.status).toBe(200);
    expect(service.merge).toHaveBeenCalledWith({
      userId: "authenticated-user",
      mergeId: MERGE_ID,
      recentSearches: [
        { query: " Hello ", searchedAt: "2026-07-20T01:00:00.000Z" }
      ]
    });
  });

  it.each([
    { merge_id: "not-a-uuid", recent_searches: [] },
    { merge_id: MERGE_ID, recent_searches: "not-an-array" },
    {
      merge_id: MERGE_ID,
      recent_searches: [{ query: "Hello", searched_at: 42 }]
    },
    { merge_id: MERGE_ID, recent_searches: [], user_id: "attacker" },
    {
      merge_id: MERGE_ID,
      recent_searches: Array.from({ length: 11 }, () => ({
        query: "Hello",
        searched_at: "2026-07-20T01:00:00.000Z"
      }))
    }
  ])("rejects malformed, oversized, or reserved input", async (body) => {
    const service = serviceStub();
    const response = await protectedHandler(
      createUserDataMergePostHandler(service)
    )(mutationRequest(body));

    expect(response.status).toBe(422);
    expect(service.merge).not.toHaveBeenCalled();
  });

  it("rejects CSRF before session or service access", async () => {
    const service = serviceStub();
    const requireSession = vi.fn(async () => ({
      user: { id: "authenticated-user" }
    }));
    const response = await protectedHandler(
      createUserDataMergePostHandler(service),
      requireSession
    )(
      new Request(`${ORIGIN}/api/user-data/merge`, {
        method: "POST",
        headers: {
          origin: "https://evil.example",
          "content-type": "application/json",
          "x-knf-request": "1"
        },
        body: JSON.stringify({ merge_id: MERGE_ID, recent_searches: [] })
      })
    );

    expect(response.status).toBe(403);
    expect(requireSession).not.toHaveBeenCalled();
    expect(service.merge).not.toHaveBeenCalled();
  });
});

function protectedHandler(
  handler: Parameters<typeof createPersonalizationHandler>[0],
  requireSession: RequireSession = async () => ({
    user: { id: "authenticated-user" }
  })
) {
  return createPersonalizationHandler(handler, {
    requireSession,
    trustedOrigin: ORIGIN,
    generateRequestId: () => "merge-request-id",
    writeSafeLog: () => undefined
  });
}

function mutationRequest(body: unknown): Request {
  return new Request(`${ORIGIN}/api/user-data/merge`, {
    method: "POST",
    headers: {
      origin: ORIGIN,
      "sec-fetch-site": "same-origin",
      "content-type": "application/json",
      "x-knf-request": "1"
    },
    body: JSON.stringify(body)
  });
}

function serviceStub(): UserDataMergeService {
  return {
    merge: vi.fn<UserDataMergeService["merge"]>(async () => ({
      merged: true as const,
      recent_searches: [],
      default_provider: {
        default_provider: null,
        source: "none" as const
      }
    }))
  };
}
