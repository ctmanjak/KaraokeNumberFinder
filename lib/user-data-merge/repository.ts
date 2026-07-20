import { Prisma, type PrismaClient } from "../generated/prisma/client";

import type {
  UserDataMergeRecord,
  UserDataMergeRepository,
  UserDataMergeWrite
} from "./service";

type UserDataMergePrismaClient = Pick<
  PrismaClient,
  "searchHistory" | "userPreference" | "karaokeProvider" | "$transaction"
>;

const historySelection = {
  id: true,
  query: true,
  normalizedQuery: true,
  searchedAt: true
} as const;

const providerSelection = {
  id: true,
  name: true,
  country: true,
  isActive: true,
  displayOrder: true,
  isDefault: true,
  lastCatalogUpdatedAt: true
} as const;

const MAX_TRANSACTION_ATTEMPTS = 3;
const TRANSACTION_MAX_WAIT_MS = 5_000;
const TRANSACTION_TIMEOUT_MS = 10_000;

export function createPrismaUserDataMergeRepository(
  prisma: UserDataMergePrismaClient
): UserDataMergeRepository {
  return {
    async merge(input, keep) {
      for (let attempt = 1; attempt <= MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
        try {
          return await mergeInTransaction(prisma, input, keep);
        } catch (error) {
          if (
            attempt === MAX_TRANSACTION_ATTEMPTS ||
            !isRetryableTransactionError(error)
          ) {
            throw error;
          }
        }
      }

      throw new Error("User data merge transaction retry was exhausted.");
    }
  };
}

async function mergeInTransaction(
  prisma: UserDataMergePrismaClient,
  input: UserDataMergeWrite,
  keep: number
): Promise<UserDataMergeRecord> {
  return prisma.$transaction(
    async (transaction) => {
      await lockUser(transaction, input.userId);

      const existingSearches = await transaction.searchHistory.findMany({
        where: { userId: input.userId },
        select: historySelection
      });
      const byNormalizedQuery = new Map(
        existingSearches.map((item) => [item.normalizedQuery, item])
      );

      for (const item of input.recentSearches) {
        const existing = byNormalizedQuery.get(item.normalizedQuery);
        if (
          existing !== undefined &&
          existing.searchedAt.getTime() >= item.searchedAt.getTime()
        ) {
          continue;
        }

        const saved = await transaction.searchHistory.upsert({
          where: {
            userId_normalizedQuery: {
              userId: input.userId,
              normalizedQuery: item.normalizedQuery
            }
          },
          create: {
            userId: input.userId,
            query: item.query,
            normalizedQuery: item.normalizedQuery,
            searchedAt: item.searchedAt
          },
          update: {
            query: item.query,
            searchedAt: item.searchedAt
          },
          select: historySelection
        });
        byNormalizedQuery.set(item.normalizedQuery, saved);
      }

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

      const recentSearches = await transaction.searchHistory.findMany({
        where: { userId: input.userId },
        orderBy: [{ searchedAt: "desc" }, { id: "desc" }],
        take: keep,
        select: historySelection
      });
      const defaultProvider = await mergeDefaultProvider(transaction, input);

      return { recentSearches, defaultProvider };
    },
    {
      maxWait: TRANSACTION_MAX_WAIT_MS,
      timeout: TRANSACTION_TIMEOUT_MS
    }
  );
}

async function mergeDefaultProvider(
  transaction: Pick<PrismaClient, "userPreference" | "karaokeProvider">,
  input: UserDataMergeWrite
): Promise<UserDataMergeRecord["defaultProvider"]> {
  const existing = await transaction.userPreference.findUnique({
    where: { userId: input.userId },
    select: { defaultProvider: { select: providerSelection } }
  });
  const hasServerPreference =
    existing !== null && existing.defaultProvider !== null;
  let userProvider = existing?.defaultProvider?.isActive
    ? existing.defaultProvider
    : null;

  if (!hasServerPreference && input.defaultProviderId !== undefined) {
    const localProvider = await transaction.karaokeProvider.findFirst({
      where: { id: input.defaultProviderId, isActive: true },
      select: providerSelection
    });

    if (localProvider !== null) {
      await transaction.userPreference.upsert({
        where: { userId: input.userId },
        create: {
          userId: input.userId,
          defaultProviderId: localProvider.id
        },
        update: { defaultProviderId: localProvider.id },
        select: { userId: true }
      });
      userProvider = localProvider;
    }
  }

  if (userProvider !== null) {
    return { provider: userProvider, source: "user" };
  }

  const operationalDefault = await transaction.karaokeProvider.findFirst({
    where: { isActive: true },
    orderBy: [
      { isDefault: "desc" },
      { displayOrder: "asc" },
      { name: "asc" },
      { id: "asc" }
    ],
    select: providerSelection
  });

  return operationalDefault === null
    ? { provider: null, source: "none" }
    : { provider: operationalDefault, source: "operational_default" };
}

async function lockUser(
  transaction: Pick<PrismaClient, "$queryRaw">,
  userId: string
): Promise<void> {
  const users = await transaction.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "users"
    WHERE "id" = ${userId}::uuid
    FOR UPDATE
  `;

  if (users.length !== 1) {
    throw new Error("Authenticated user is unavailable.");
  }
}

function isRetryableTransactionError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === "P2002" || error.code === "P2034")
  );
}
