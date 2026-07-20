import { describe, expect, it, vi } from "vitest";

import { Prisma, type PrismaClient } from "../generated/prisma/client";
import { createPrismaUserDataMergeRepository } from "./repository";

const USER_ID = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const ITEM_ID = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
const STALE_ID = "cccccccc-cccc-4ccc-bccc-cccccccccccc";
const MERGE_ID = "dddddddd-dddd-4ddd-bddd-dddddddddddd";

describe("Prisma user data merge repository", () => {
  it("makes an identical retry idempotent by keeping an equal normalized row", async () => {
    const searchedAt = new Date("2026-07-20T01:00:00.000Z");
    const existing = historyRecord("Server Display", searchedAt);
    const prisma = prismaStub({
      existingSearches: [existing],
      recentSearches: [existing],
      existingPreference: { defaultProvider: providerRecord() }
    });
    const repository = createPrismaUserDataMergeRepository(prisma.client);

    await expect(
      repository.merge(
        {
          userId: USER_ID,
          mergeId: MERGE_ID,
          recentSearches: [
            {
              query: "Retried Display",
              normalizedQuery: "hello",
              searchedAt
            }
          ]
        },
        10
      )
    ).resolves.toEqual({
      recentSearches: [existing],
      defaultProvider: { provider: providerRecord(), source: "user" }
    });

    expect(prisma.queryRaw).toHaveBeenCalledTimes(1);
    expect(prisma.history.upsert).not.toHaveBeenCalled();
    expect(prisma.preference.upsert).not.toHaveBeenCalled();
    expect(prisma.provider.findFirst).not.toHaveBeenCalled();
  });

  it("updates only a newer local duplicate, prunes to ten, and seeds an active local provider atomically", async () => {
    const old = historyRecord(
      "Old Display",
      new Date("2026-07-20T01:00:00.000Z")
    );
    const newer = historyRecord(
      "New Display",
      new Date("2026-07-20T02:00:00.000Z")
    );
    const provider = providerRecord("provider-local");
    const prisma = prismaStub({
      existingSearches: [old],
      saved: newer,
      stale: [{ id: STALE_ID }],
      recentSearches: [newer],
      existingPreference: null,
      providerResults: [provider]
    });
    const repository = createPrismaUserDataMergeRepository(prisma.client);

    await repository.merge(
      {
        userId: USER_ID,
        mergeId: MERGE_ID,
        recentSearches: [
          {
            query: "New Display",
            normalizedQuery: "hello",
            searchedAt: newer.searchedAt
          }
        ],
        defaultProviderId: provider.id
      },
      10
    );

    expect(prisma.history.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId_normalizedQuery: {
            userId: USER_ID,
            normalizedQuery: "hello"
          }
        },
        update: { query: "New Display", searchedAt: newer.searchedAt }
      })
    );
    expect(prisma.history.deleteMany).toHaveBeenCalledWith({
      where: { userId: USER_ID, id: { in: [STALE_ID] } }
    });
    expect(prisma.preference.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: { userId: USER_ID, defaultProviderId: provider.id },
        update: { defaultProviderId: provider.id }
      })
    );
    expect(prisma.transaction).toHaveBeenCalledWith(expect.any(Function), {
      maxWait: 5_000,
      timeout: 10_000
    });
  });

  it.each(["P2002", "P2034"])(
    "retries a %s transaction conflict",
    async (code) => {
      const prisma = prismaStub({
        transactionFailures: [knownPrismaError(code)],
        existingPreference: { defaultProvider: providerRecord() }
      });
      const repository = createPrismaUserDataMergeRepository(prisma.client);

      await expect(
        repository.merge(
          {
            userId: USER_ID,
            mergeId: MERGE_ID,
            recentSearches: []
          },
          10
        )
      ).resolves.toBeDefined();
      expect(prisma.transaction).toHaveBeenCalledTimes(2);
    }
  );

  it("fails before reading user data when the authenticated user cannot be locked", async () => {
    const prisma = prismaStub({ lockedUsers: [] });
    const repository = createPrismaUserDataMergeRepository(prisma.client);

    await expect(
      repository.merge(
        { userId: USER_ID, mergeId: MERGE_ID, recentSearches: [] },
        10
      )
    ).rejects.toThrow("Authenticated user is unavailable.");
    expect(prisma.history.findMany).not.toHaveBeenCalled();
  });
});

function knownPrismaError(code: string) {
  return new Prisma.PrismaClientKnownRequestError("internal detail", {
    code,
    clientVersion: "7.8.0"
  });
}

function prismaStub(
  options: {
    existingSearches?: ReturnType<typeof historyRecord>[];
    existingPreference?: {
      defaultProvider: ReturnType<typeof providerRecord>;
    } | null;
    lockedUsers?: Array<{ id: string }>;
    providerResults?: Array<ReturnType<typeof providerRecord> | null>;
    recentSearches?: ReturnType<typeof historyRecord>[];
    saved?: ReturnType<typeof historyRecord>;
    stale?: Array<{ id: string }>;
    transactionFailures?: unknown[];
  } = {}
) {
  const transactionFailures = [...(options.transactionFailures ?? [])];
  const providerResults = [...(options.providerResults ?? [])];
  let historyFindCall = 0;
  const history = {
    findMany: vi.fn(async () => {
      historyFindCall += 1;
      if (historyFindCall === 1) {
        return options.existingSearches ?? [];
      }
      if (historyFindCall === 2) {
        return options.stale ?? [];
      }
      return options.recentSearches ?? [];
    }),
    upsert: vi.fn(async () => options.saved ?? historyRecord()),
    deleteMany: vi.fn(async () => ({ count: options.stale?.length ?? 0 }))
  };
  const preference = {
    findUnique: vi.fn(async () => options.existingPreference ?? null),
    upsert: vi.fn(async () => ({ userId: USER_ID }))
  };
  const provider = {
    findFirst: vi.fn(async () => providerResults.shift() ?? null)
  };
  const queryRaw = vi.fn(async () => options.lockedUsers ?? [{ id: USER_ID }]);
  const transactionClient = {
    searchHistory: history,
    userPreference: preference,
    karaokeProvider: provider,
    $queryRaw: queryRaw
  };
  const transaction = vi.fn(async (callback: (client: unknown) => unknown) => {
    const failure = transactionFailures.shift();
    if (failure !== undefined) {
      throw failure;
    }
    return callback(transactionClient);
  });
  const client = {
    searchHistory: history,
    userPreference: preference,
    karaokeProvider: provider,
    $transaction: transaction
  } as unknown as Pick<
    PrismaClient,
    "searchHistory" | "userPreference" | "karaokeProvider" | "$transaction"
  >;

  return {
    client,
    history,
    preference,
    provider,
    queryRaw,
    transaction
  };
}

function historyRecord(
  query = "Hello",
  searchedAt = new Date("2026-07-20T01:00:00.000Z")
) {
  return {
    id: ITEM_ID,
    query,
    normalizedQuery: "hello",
    searchedAt
  };
}

function providerRecord(id = "provider-default") {
  return {
    id,
    name: "Provider",
    country: "KR",
    isActive: true,
    displayOrder: 10,
    isDefault: true,
    lastCatalogUpdatedAt: null
  };
}
