import { describe, expect, it, vi } from "vitest";

import { PersonalizationApiError } from "../personalization";
import type { SearchHistoryRecord } from "../search-history/service";
import {
  createUserDataMergeService,
  type UserDataMergeRecord,
  type UserDataMergeRepository
} from "./service";

const NOW = new Date("2026-07-20T03:00:00.000Z");

describe("user data merge service", () => {
  it("normalizes, deduplicates by latest timestamp, and clamps far-future searches", async () => {
    const repository = repositoryStub();
    const service = createUserDataMergeService(repository, { now: () => NOW });

    await service.merge({
      userId: "user-a",
      mergeId: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
      recentSearches: [
        { query: " Love (Live)! ", searchedAt: "2026-07-20T01:00:00.000Z" },
        { query: "LOVE LIVE", searchedAt: "2026-07-20T02:00:00.000Z" },
        { query: "Future", searchedAt: "2026-07-20T03:05:01.000Z" }
      ]
    });

    expect(repository.merge).toHaveBeenCalledWith(
      {
        userId: "user-a",
        mergeId: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
        recentSearches: [
          {
            query: "Future",
            normalizedQuery: "future",
            searchedAt: NOW
          },
          {
            query: "LOVE LIVE",
            normalizedQuery: "lovelive",
            searchedAt: new Date("2026-07-20T02:00:00.000Z")
          }
        ]
      },
      10
    );
  });

  it("preserves a future timestamp within the five-minute allowance", async () => {
    const repository = repositoryStub();
    const service = createUserDataMergeService(repository, { now: () => NOW });
    const allowed = "2026-07-20T03:05:00.000Z";

    await service.merge({
      userId: "user-a",
      mergeId: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
      recentSearches: [{ query: "Allowed", searchedAt: allowed }]
    });

    expect(repository.merge).toHaveBeenCalledWith(
      expect.objectContaining({
        recentSearches: [
          expect.objectContaining({ searchedAt: new Date(allowed) })
        ]
      }),
      10
    );
  });

  it.each([
    ["trimmed empty", "   ", "2026-07-20T01:00:00.000Z"],
    ["query over 200", "가".repeat(201), "2026-07-20T01:00:00.000Z"],
    ["invalid date", "Hello", "not-a-date"],
    ["invalid calendar date", "Hello", "2026-02-30T00:00:00.000Z"]
  ])(
    "rejects %s before repository access",
    async (_name, query, searchedAt) => {
      const repository = repositoryStub();
      const service = createUserDataMergeService(repository, {
        now: () => NOW
      });

      await expect(
        service.merge({
          userId: "user-a",
          mergeId: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
          recentSearches: [{ query, searchedAt }]
        })
      ).rejects.toEqual(
        expect.objectContaining<Partial<PersonalizationApiError>>({
          code: "VALIDATION_ERROR"
        })
      );
      expect(repository.merge).not.toHaveBeenCalled();
    }
  );

  it("maps repository records to the merge response contract", async () => {
    const searchedAt = new Date("2026-07-20T02:00:00.000Z");
    const repository = repositoryStub({
      recentSearches: [historyRecord(searchedAt)]
    });
    const service = createUserDataMergeService(repository, { now: () => NOW });

    await expect(
      service.merge({
        userId: "user-a",
        mergeId: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
        recentSearches: []
      })
    ).resolves.toEqual({
      merged: true,
      recent_searches: [
        {
          id: "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb",
          query: "Hello",
          normalized_query: "hello",
          searched_at: searchedAt.toISOString()
        }
      ],
      default_provider: { default_provider: null, source: "none" }
    });
  });
});

function repositoryStub(
  overrides: Partial<Awaited<ReturnType<UserDataMergeRepository["merge"]>>> = {}
): UserDataMergeRepository {
  const record: UserDataMergeRecord = {
    recentSearches: [],
    defaultProvider: { provider: null, source: "none" },
    ...overrides
  };
  return {
    merge: vi.fn(async () => record)
  };
}

function historyRecord(searchedAt: Date): SearchHistoryRecord {
  return {
    id: "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb",
    query: "Hello",
    normalizedQuery: "hello",
    searchedAt
  };
}
