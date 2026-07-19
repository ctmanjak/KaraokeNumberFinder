import { describe, expect, it, vi } from "vitest";

import { Prisma, type PrismaClient } from "../generated/prisma/client";
import { createPrismaUserPreferenceRepository } from "./repository";

const USER_ID = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const PROVIDER_ID = "provider-active";

describe("Prisma user preference repository", () => {
  it("finds only the requested user's preference and provider fields", async () => {
    const prisma = prismaStub();
    const repository = createPrismaUserPreferenceRepository(prisma.client);

    await repository.find({ userId: USER_ID });

    expect(prisma.preference.findUnique).toHaveBeenCalledWith({
      where: { userId: USER_ID },
      select: {
        defaultProvider: {
          select: providerSelection()
        }
      }
    });
  });

  it("lists active providers in deterministic operational order", async () => {
    const prisma = prismaStub();
    const repository = createPrismaUserPreferenceRepository(prisma.client);

    await repository.listActiveProviders();

    expect(prisma.provider.findMany).toHaveBeenCalledWith({
      where: { isActive: true },
      orderBy: [
        { isDefault: "desc" },
        { displayOrder: "asc" },
        { name: "asc" },
        { id: "asc" }
      ],
      select: providerSelection()
    });
  });

  it("locks the user and active provider before upserting", async () => {
    const prisma = prismaStub();
    const repository = createPrismaUserPreferenceRepository(prisma.client);

    await expect(
      repository.setDefaultProvider({
        userId: USER_ID,
        providerId: PROVIDER_ID
      })
    ).resolves.toBe(true);

    expect(prisma.queryRaw).toHaveBeenCalledTimes(2);
    expect(prisma.preference.upsert).toHaveBeenCalledWith({
      where: { userId: USER_ID },
      create: { userId: USER_ID, defaultProviderId: PROVIDER_ID },
      update: { defaultProviderId: PROVIDER_ID },
      select: { userId: true }
    });
    expect(prisma.queryRaw.mock.invocationCallOrder[1]).toBeLessThan(
      prisma.preference.upsert.mock.invocationCallOrder[0]
    );
  });

  it("rejects an inactive or missing provider before upsert", async () => {
    const prisma = prismaStub({ providerLocks: [[]] });
    const repository = createPrismaUserPreferenceRepository(prisma.client);

    await expect(
      repository.setDefaultProvider({
        userId: USER_ID,
        providerId: "provider-inactive"
      })
    ).resolves.toBe(false);
    expect(prisma.preference.upsert).not.toHaveBeenCalled();
  });

  it.each(["P2002", "P2034"])(
    "retries a %s transaction collision",
    async (code) => {
      const prisma = prismaStub({
        transactionFailures: [knownPrismaError(code)]
      });
      const repository = createPrismaUserPreferenceRepository(prisma.client);

      await expect(
        repository.setDefaultProvider({
          userId: USER_ID,
          providerId: PROVIDER_ID
        })
      ).resolves.toBe(true);
      expect(prisma.transaction).toHaveBeenCalledTimes(2);
    }
  );

  it("maps a provider FK race to the invalid-provider outcome", async () => {
    const prisma = prismaStub({
      transactionFailures: [knownPrismaError("P2003")]
    });
    const repository = createPrismaUserPreferenceRepository(prisma.client);

    await expect(
      repository.setDefaultProvider({
        userId: USER_ID,
        providerId: PROVIDER_ID
      })
    ).resolves.toBe(false);
  });

  it("locks the user and deletes only its row when clearing", async () => {
    const prisma = prismaStub();
    const repository = createPrismaUserPreferenceRepository(prisma.client);

    await repository.clearDefaultProvider({ userId: USER_ID });

    expect(prisma.queryRaw).toHaveBeenCalledTimes(1);
    expect(prisma.preference.deleteMany).toHaveBeenCalledWith({
      where: { userId: USER_ID }
    });
    expect(prisma.preference.upsert).not.toHaveBeenCalled();
  });

  it("fails safely before writes when the authenticated user is gone", async () => {
    const prisma = prismaStub({ userLocks: [[]] });
    const repository = createPrismaUserPreferenceRepository(prisma.client);

    await expect(
      repository.setDefaultProvider({
        userId: USER_ID,
        providerId: PROVIDER_ID
      })
    ).rejects.toThrow("Authenticated user is unavailable.");
    expect(prisma.preference.upsert).not.toHaveBeenCalled();
  });
});

function providerSelection() {
  return {
    id: true,
    name: true,
    country: true,
    isActive: true,
    displayOrder: true,
    isDefault: true,
    lastCatalogUpdatedAt: true
  };
}

function knownPrismaError(code: string) {
  return new Prisma.PrismaClientKnownRequestError("internal database detail", {
    code,
    clientVersion: "7.8.0"
  });
}

function prismaStub(
  options: {
    providerLocks?: Array<Array<{ id: string }>>;
    transactionFailures?: unknown[];
    userLocks?: Array<Array<{ id: string }>>;
  } = {}
) {
  const preference = {
    findUnique: vi.fn(async () => null),
    upsert: vi.fn(async () => ({ userId: USER_ID })),
    deleteMany: vi.fn(async () => ({ count: 1 }))
  };
  const provider = {
    findMany: vi.fn(async () => [])
  };
  const userLocks = [...(options.userLocks ?? [[{ id: USER_ID }]])];
  const providerLocks = [...(options.providerLocks ?? [[{ id: PROVIDER_ID }]])];
  let queryIndex = 0;
  const queryRaw = vi.fn(async () => {
    const result =
      queryIndex % 2 === 0
        ? (userLocks.shift() ?? [{ id: USER_ID }])
        : (providerLocks.shift() ?? [{ id: PROVIDER_ID }]);
    queryIndex += 1;
    return result;
  });
  const transactionClient = {
    userPreference: preference,
    $queryRaw: queryRaw
  };
  const failures = [...(options.transactionFailures ?? [])];
  const transaction = vi.fn(async (callback: (client: unknown) => unknown) => {
    const failure = failures.shift();
    if (failure !== undefined) {
      throw failure;
    }
    return callback(transactionClient);
  });
  const client = {
    userPreference: preference,
    karaokeProvider: provider,
    $transaction: transaction
  } as unknown as Pick<
    PrismaClient,
    "userPreference" | "karaokeProvider" | "$transaction"
  >;

  return { client, preference, provider, queryRaw, transaction };
}
