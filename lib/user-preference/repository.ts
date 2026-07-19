import { Prisma, type PrismaClient } from "../generated/prisma/client";

import type { UserPreferenceRepository } from "./service";

type UserPreferencePrismaClient = Pick<
  PrismaClient,
  "userPreference" | "karaokeProvider" | "$transaction"
>;

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

export function createPrismaUserPreferenceRepository(
  prisma: UserPreferencePrismaClient
): UserPreferenceRepository {
  return {
    async find(owner) {
      return prisma.userPreference.findUnique({
        where: { userId: owner.userId },
        select: {
          defaultProvider: {
            select: providerSelection
          }
        }
      });
    },

    async listActiveProviders() {
      return prisma.karaokeProvider.findMany({
        where: { isActive: true },
        orderBy: [
          { isDefault: "desc" },
          { displayOrder: "asc" },
          { name: "asc" },
          { id: "asc" }
        ],
        select: providerSelection
      });
    },

    async setDefaultProvider(input) {
      for (let attempt = 1; attempt <= MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
        try {
          return await setDefaultProvider(prisma, input);
        } catch (error) {
          if (isPrismaError(error, "P2003")) {
            return false;
          }

          if (
            attempt === MAX_TRANSACTION_ATTEMPTS ||
            !isRetryableTransactionError(error)
          ) {
            throw error;
          }
        }
      }

      return false;
    },

    async clearDefaultProvider(owner) {
      await prisma.$transaction(
        async (transaction) => {
          await lockUser(transaction, owner.userId);
          await transaction.userPreference.deleteMany({
            where: { userId: owner.userId }
          });
        },
        {
          maxWait: TRANSACTION_MAX_WAIT_MS,
          timeout: TRANSACTION_TIMEOUT_MS
        }
      );
    }
  };
}

async function setDefaultProvider(
  prisma: UserPreferencePrismaClient,
  input: { userId: string; providerId: string }
): Promise<boolean> {
  return prisma.$transaction(
    async (transaction) => {
      await lockUser(transaction, input.userId);
      const providers = await transaction.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "karaoke_providers"
        WHERE "id" = ${input.providerId} AND "is_active" = TRUE
        FOR UPDATE
      `;

      if (providers.length !== 1) {
        return false;
      }

      await transaction.userPreference.upsert({
        where: { userId: input.userId },
        create: {
          userId: input.userId,
          defaultProviderId: input.providerId
        },
        update: { defaultProviderId: input.providerId },
        select: { userId: true }
      });

      return true;
    },
    {
      maxWait: TRANSACTION_MAX_WAIT_MS,
      timeout: TRANSACTION_TIMEOUT_MS
    }
  );
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
  return isPrismaError(error, "P2002") || isPrismaError(error, "P2034");
}

function isPrismaError(error: unknown, code: string): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === code
  );
}
