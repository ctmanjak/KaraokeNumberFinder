import { describe, expect, it, vi } from "vitest";

import { Prisma, type PrismaClient } from "../generated/prisma/client";
import { createPrismaSearchHistoryRepository } from "./repository";

const USER_ID = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const ITEM_ID = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
const STALE_ID = "cccccccc-cccc-4ccc-bccc-cccccccccccc";

describe("Prisma search history repository", () => {
  it("lists only the owner in stable descending order with a hard limit", async () => {
    const prisma = prismaStub();
    const repository = createPrismaSearchHistoryRepository(prisma.client);

    await repository.list({ userId: USER_ID }, 10);

    expect(prisma.rootHistory.findMany).toHaveBeenCalledWith({
      where: { userId: USER_ID },
      orderBy: [{ searchedAt: "desc" }, { id: "desc" }],
      take: 10,
      select: {
        id: true,
        query: true,
        normalizedQuery: true,
        searchedAt: true
      }
    });
  });

  it("locks the user before unique upsert and stable pruning in one transaction", async () => {
    const searchedAt = new Date("2026-07-19T05:00:00.000Z");
    const prisma = prismaStub({
      stale: [{ id: STALE_ID }],
      saved: {
        id: ITEM_ID,
        query: "Updated Query",
        normalizedQuery: "updatedquery",
        searchedAt
      }
    });
    const now = vi.fn(() => searchedAt);
    const repository = createPrismaSearchHistoryRepository(prisma.client, {
      now
    });
    const input = {
      userId: USER_ID,
      query: "Updated Query",
      normalizedQuery: "updatedquery"
    };

    await expect(repository.save(input, 10)).resolves.toEqual({
      id: ITEM_ID,
      query: "Updated Query",
      normalizedQuery: "updatedquery",
      searchedAt
    });

    expect(prisma.transaction).toHaveBeenCalledTimes(1);
    expect(prisma.queryRaw).toHaveBeenCalledTimes(1);
    expect(now).toHaveBeenCalledTimes(1);
    expect(prisma.transactionHistory.upsert).toHaveBeenCalledWith({
      where: {
        userId_normalizedQuery: {
          userId: USER_ID,
          normalizedQuery: "updatedquery"
        }
      },
      create: { ...input, searchedAt },
      update: { query: "Updated Query", searchedAt },
      select: {
        id: true,
        query: true,
        normalizedQuery: true,
        searchedAt: true
      }
    });
    expect(prisma.transactionHistory.findMany).toHaveBeenCalledWith({
      where: { userId: USER_ID },
      orderBy: [{ searchedAt: "desc" }, { id: "desc" }],
      skip: 10,
      select: { id: true }
    });
    expect(prisma.transactionHistory.deleteMany).toHaveBeenCalledWith({
      where: {
        userId: USER_ID,
        id: { in: [STALE_ID] }
      }
    });
    expect(prisma.queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      now.mock.invocationCallOrder[0]
    );
    expect(now.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.transactionHistory.upsert.mock.invocationCallOrder[0]
    );
    expect(
      prisma.transactionHistory.upsert.mock.invocationCallOrder[0]
    ).toBeLessThan(
      prisma.transactionHistory.findMany.mock.invocationCallOrder[0]
    );
  });

  it("does not prune when the locked user's count is within the limit", async () => {
    const prisma = prismaStub();
    const repository = createPrismaSearchHistoryRepository(prisma.client);

    await repository.save(
      { userId: USER_ID, query: "Hello", normalizedQuery: "hello" },
      10
    );

    expect(prisma.transactionHistory.deleteMany).not.toHaveBeenCalled();
  });

  it.each(["P2002", "P2034"])(
    "retries a %s collision instead of exposing it as a failure",
    async (code) => {
      const prisma = prismaStub({
        transactionFailures: [knownPrismaError(code)]
      });
      const repository = createPrismaSearchHistoryRepository(prisma.client);

      await expect(
        repository.save(
          { userId: USER_ID, query: "Hello", normalizedQuery: "hello" },
          10
        )
      ).resolves.toMatchObject({ normalizedQuery: "hello" });
      expect(prisma.transaction).toHaveBeenCalledTimes(2);
    }
  );

  it("fails before upsert if the authenticated user row cannot be locked", async () => {
    const prisma = prismaStub({ lockedUsers: [] });
    const repository = createPrismaSearchHistoryRepository(prisma.client);

    await expect(
      repository.save(
        { userId: USER_ID, query: "Hello", normalizedQuery: "hello" },
        10
      )
    ).rejects.toThrow("Authenticated user is unavailable.");
    expect(prisma.transactionHistory.upsert).not.toHaveBeenCalled();
  });

  it("deletes an item with id and owner together and keeps missing rows idempotent", async () => {
    const prisma = prismaStub({ rootDeleteCounts: [1, 0] });
    const repository = createPrismaSearchHistoryRepository(prisma.client);
    const identity = { userId: USER_ID, id: ITEM_ID };

    await expect(repository.delete(identity)).resolves.toBe(1);
    await expect(repository.delete(identity)).resolves.toBe(0);
    expect(prisma.rootHistory.deleteMany).toHaveBeenNthCalledWith(1, {
      where: { id: ITEM_ID, userId: USER_ID }
    });
  });

  it("clears only the authenticated owner's rows", async () => {
    const prisma = prismaStub({ rootDeleteCounts: [4] });
    const repository = createPrismaSearchHistoryRepository(prisma.client);

    await expect(repository.clear({ userId: USER_ID })).resolves.toBe(4);
    expect(prisma.rootHistory.deleteMany).toHaveBeenCalledWith({
      where: { userId: USER_ID }
    });
  });
});

function knownPrismaError(code: string) {
  return new Prisma.PrismaClientKnownRequestError("internal database detail", {
    code,
    clientVersion: "7.8.0"
  });
}

function prismaStub(
  options: {
    lockedUsers?: Array<{ id: string }>;
    rootDeleteCounts?: number[];
    saved?: {
      id: string;
      query: string;
      normalizedQuery: string;
      searchedAt: Date;
    };
    stale?: Array<{ id: string }>;
    transactionFailures?: unknown[];
  } = {}
) {
  const defaultSaved = {
    id: ITEM_ID,
    query: "Hello",
    normalizedQuery: "hello",
    searchedAt: new Date("2026-07-19T00:00:00.000Z")
  };
  const rootDeleteCounts = [...(options.rootDeleteCounts ?? [])];
  const transactionFailures = [...(options.transactionFailures ?? [])];
  const rootHistory = {
    findMany: vi.fn(async () => []),
    deleteMany: vi.fn(async () => ({ count: rootDeleteCounts.shift() ?? 0 }))
  };
  const transactionHistory = {
    upsert: vi.fn(async () => options.saved ?? defaultSaved),
    findMany: vi.fn(async () => options.stale ?? []),
    deleteMany: vi.fn(async () => ({ count: options.stale?.length ?? 0 }))
  };
  const queryRaw = vi.fn(async () => options.lockedUsers ?? [{ id: USER_ID }]);
  const transactionClient = {
    searchHistory: transactionHistory,
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
    searchHistory: rootHistory,
    $transaction: transaction
  } as unknown as Pick<PrismaClient, "searchHistory" | "$transaction">;

  return {
    client,
    rootHistory,
    transactionHistory,
    queryRaw,
    transaction
  };
}
