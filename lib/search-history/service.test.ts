import { describe, expect, it, vi } from "vitest";

import { PersonalizationApiError } from "../personalization";
import {
  MAX_SEARCH_HISTORY_ITEMS,
  createSearchHistoryService,
  type SearchHistoryRecord,
  type SearchHistoryRepository
} from "./service";

describe("search history service", () => {
  it("returns at most ten records in the repository's stable order", async () => {
    const records = [
      historyRecord(
        "ffffffff-ffff-4fff-bfff-ffffffffffff",
        "Newest",
        "newest",
        "2026-07-19T03:00:00.000Z"
      ),
      historyRecord(
        "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
        "Older",
        "older",
        "2026-07-19T02:00:00.000Z"
      )
    ];
    const repository = repositoryStub({ list: vi.fn(async () => records) });
    const service = createSearchHistoryService(repository);

    const response = await service.list({ userId: "user-a" });

    expect(repository.list).toHaveBeenCalledWith(
      { userId: "user-a" },
      MAX_SEARCH_HISTORY_ITEMS
    );
    expect(response).toEqual({
      items: [
        {
          id: records[0].id,
          query: "Newest",
          normalized_query: "newest",
          searched_at: "2026-07-19T03:00:00.000Z"
        },
        {
          id: records[1].id,
          query: "Older",
          normalized_query: "older",
          searched_at: "2026-07-19T02:00:00.000Z"
        }
      ]
    });
  });

  it("trims the display query and reuses normalizeSearchText semantics", async () => {
    const searchedAt = new Date("2026-07-19T04:00:00.000Z");
    const repository = repositoryStub({
      save: vi.fn(async (input) => ({
        id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
        query: input.query,
        normalizedQuery: input.normalizedQuery,
        searchedAt
      }))
    });
    const service = createSearchHistoryService(repository);

    const response = await service.save({
      userId: "user-a",
      query: "  Love (Live)!・_  "
    });

    expect(repository.save).toHaveBeenCalledWith(
      {
        userId: "user-a",
        query: "Love (Live)!・_",
        normalizedQuery: "lovelive"
      },
      MAX_SEARCH_HISTORY_ITEMS
    );
    expect(response.item).toEqual({
      id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
      query: "Love (Live)!・_",
      normalized_query: "lovelive",
      searched_at: searchedAt.toISOString()
    });
  });

  it.each([
    ["trimmed empty", "   "],
    ["normalized empty", " -_・.'!?()[]{} "],
    ["display longer than 200", "가".repeat(201)],
    ["normalized value longer than 200", "㍍".repeat(51)]
  ])("rejects %s input before repository access", async (_name, query) => {
    const repository = repositoryStub();
    const service = createSearchHistoryService(repository);

    await expect(service.save({ userId: "user-a", query })).rejects.toEqual(
      expect.objectContaining<Partial<PersonalizationApiError>>({
        code: "VALIDATION_ERROR",
        status: 422
      })
    );
    expect(repository.save).not.toHaveBeenCalled();
  });

  it("maps owner-scoped individual and bulk delete counts", async () => {
    const repository = repositoryStub({
      delete: vi.fn(async () => 1),
      clear: vi.fn(async () => 7)
    });
    const service = createSearchHistoryService(repository);
    const identity = {
      userId: "user-a",
      id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa"
    };

    await expect(service.delete(identity)).resolves.toEqual({
      deleted_count: 1
    });
    await expect(service.clear({ userId: "user-a" })).resolves.toEqual({
      deleted_count: 7
    });
    expect(repository.delete).toHaveBeenCalledWith(identity);
    expect(repository.clear).toHaveBeenCalledWith({ userId: "user-a" });
  });
});

function repositoryStub(
  overrides: Partial<SearchHistoryRepository> = {}
): SearchHistoryRepository {
  return {
    list: vi.fn(async () => []),
    save: vi.fn(async (input) => ({
      id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
      query: input.query,
      normalizedQuery: input.normalizedQuery,
      searchedAt: new Date("2026-07-19T00:00:00.000Z")
    })),
    delete: vi.fn(async () => 0),
    clear: vi.fn(async () => 0),
    ...overrides
  };
}

function historyRecord(
  id: string,
  query: string,
  normalizedQuery: string,
  searchedAt: string
): SearchHistoryRecord {
  return {
    id,
    query,
    normalizedQuery,
    searchedAt: new Date(searchedAt)
  };
}
