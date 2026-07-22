import { Prisma, type PrismaClient } from "../generated/prisma/client";

import type {
  SearchHistoryRecord,
  SearchHistoryRepository,
  SearchHistoryWrite
} from "./service";

type SearchHistoryPrismaClient = Pick<
  PrismaClient,
  "searchHistory" | "$transaction"
>;

const historySelection = {
  id: true,
  query: true,
  normalizedQuery: true,
  searchedAt: true
} as const;

const MAX_TRANSACTION_ATTEMPTS = 3;
const TRANSACTION_MAX_WAIT_MS = 5_000;
const TRANSACTION_TIMEOUT_MS = 10_000;

export function createPrismaSearchHistoryRepository(
  prisma: SearchHistoryPrismaClient,
  options: { now?: () => Date } = {}
): SearchHistoryRepository {
  return {
    async list(owner, take) {
      return prisma.searchHistory.findMany({
        where: { userId: owner.userId },
        orderBy: [{ searchedAt: "desc" }, { id: "desc" }],
        take,
        select: historySelection
      });
    },

    async save(input, keep) {
      for (let attempt = 1; attempt <= MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
        try {
          return await saveAndPrune(prisma, input, keep, options.now);
        } catch (error) {
          if (
            attempt === MAX_TRANSACTION_ATTEMPTS ||
            !isRetryableTransactionError(error)
          ) {
            throw error;
          }
        }
      }

      throw new Error("Search history transaction retry was exhausted.");
    },

    async delete(identity) {
      const result = await prisma.searchHistory.deleteMany({
        where: {
          id: identity.id,
          userId: identity.userId
        }
      });
      return result.count;
    },

    async clear(owner) {
      const result = await prisma.searchHistory.deleteMany({
        where: { userId: owner.userId }
      });
      return result.count;
    }
  };
}

async function saveAndPrune(
  prisma: SearchHistoryPrismaClient,
  input: SearchHistoryWrite,
  keep: number,
  now: (() => Date) | undefined
): Promise<SearchHistoryRecord> {
  return prisma.$transaction(
    async (transaction) => {
      const lockedUsers = await transaction.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "users"
        WHERE "id" = ${input.userId}::uuid
        FOR UPDATE
      `;

      if (lockedUsers.length !== 1) {
        throw new Error("Authenticated user is unavailable.");
      }

      const searchedAt = now?.() ?? new Date();

      const saved = await transaction.searchHistory.upsert({
        where: {
          userId_normalizedQuery: {
            userId: input.userId,
            normalizedQuery: input.normalizedQuery
          }
        },
        create: {
          ...input,
          searchedAt
        },
        update: {
          query: input.query,
          searchedAt
        },
        select: historySelection
      });

      const stale = await transaction.searchHistory.findMany({
        where: { userId: input.userId },
        orderBy: [{ searchedAt: "desc" }, { id: "desc" }],
        skip: keep,
        select: { id: true }
      });

      if (stale.length > 0) {
        await transaction.searchHistory.deleteMany({
          where: {
            userId: input.userId,
            id: { in: stale.map(({ id }) => id) }
          }
        });
      }

      return saved;
    },
    {
      maxWait: TRANSACTION_MAX_WAIT_MS,
      timeout: TRANSACTION_TIMEOUT_MS
    }
  );
}

function isRetryableTransactionError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === "P2002" || error.code === "P2034")
  );
}
