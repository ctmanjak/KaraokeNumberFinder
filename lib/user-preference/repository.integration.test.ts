import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { optionalM3TestDatabaseUrl } from "../../scripts/m3/test-db-url";
import { PersonalizationApiError } from "../personalization";
import { PrismaClient } from "../generated/prisma/client";
import { createPrismaUserPreferenceRepository } from "./repository";
import { createUserPreferenceService } from "./service";

const testDatabaseUrl = optionalM3TestDatabaseUrl(
  process.env.M3_TEST_DATABASE_URL
);
const describeDatabase =
  testDatabaseUrl === undefined ? describe.skip : describe;

describeDatabase("user preference repository on PostgreSQL", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: testDatabaseUrl, max: 20 })
    });
  });

  beforeEach(async () => {
    await prisma.user.deleteMany();
    await prisma.karaokeEntry.deleteMany();
    await prisma.karaokeProvider.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("stores and reads each user's active provider and clears only that user", async () => {
    const fallbackId = await createProvider(prisma, {
      id: "preference-fallback",
      name: "Fallback Provider",
      displayOrder: 10,
      isDefault: true
    });
    const selectedId = await createProvider(prisma, {
      id: "preference-selected",
      name: "Selected Provider",
      displayOrder: 20
    });
    const userId = await createUser(prisma, "preference-a@example.com");
    const otherUserId = await createUser(prisma, "preference-b@example.com");
    const repository = createPrismaUserPreferenceRepository(prisma);
    const service = createUserPreferenceService(repository);

    await expect(
      service.setDefaultProvider({ userId, providerId: selectedId })
    ).resolves.toMatchObject({
      default_provider: { id: selectedId },
      source: "user"
    });
    await expect(service.get({ userId: otherUserId })).resolves.toMatchObject({
      default_provider: { id: fallbackId },
      source: "operational_default"
    });
    await expect(
      prisma.userPreference.count({ where: { userId: otherUserId } })
    ).resolves.toBe(0);

    await expect(
      service.setDefaultProvider({ userId, providerId: null })
    ).resolves.toMatchObject({
      default_provider: { id: fallbackId },
      source: "operational_default"
    });
    await expect(
      prisma.userPreference.count({ where: { userId } })
    ).resolves.toBe(0);
  });

  it("uses SetNull on provider deletion and falls back without persisting", async () => {
    const fallbackId = await createProvider(prisma, {
      id: "delete-fallback",
      name: "Delete Fallback",
      displayOrder: 10,
      isDefault: true
    });
    const deletedId = await createProvider(prisma, {
      id: "delete-selected",
      name: "Delete Selected",
      displayOrder: 20
    });
    const userId = await createUser(prisma, "preference-delete@example.com");
    const repository = createPrismaUserPreferenceRepository(prisma);
    const service = createUserPreferenceService(repository);

    await service.setDefaultProvider({ userId, providerId: deletedId });
    await prisma.karaokeProvider.delete({ where: { id: deletedId } });

    await expect(
      prisma.userPreference.findUnique({
        where: { userId },
        select: { defaultProviderId: true }
      })
    ).resolves.toEqual({ defaultProviderId: null });
    await expect(service.get({ userId })).resolves.toMatchObject({
      default_provider: { id: fallbackId },
      source: "operational_default"
    });
  });

  it("rejects inactive writes and falls back from a newly inactive stored provider", async () => {
    const fallbackId = await createProvider(prisma, {
      id: "inactive-fallback",
      name: "Inactive Fallback",
      displayOrder: 10,
      isDefault: true
    });
    const disabledId = await createProvider(prisma, {
      id: "inactive-selected",
      name: "Inactive Selected",
      displayOrder: 20
    });
    const userId = await createUser(prisma, "preference-inactive@example.com");
    const service = createUserPreferenceService(
      createPrismaUserPreferenceRepository(prisma)
    );

    await service.setDefaultProvider({ userId, providerId: disabledId });
    await prisma.karaokeProvider.update({
      where: { id: disabledId },
      data: { isActive: false }
    });

    await expect(service.get({ userId })).resolves.toMatchObject({
      default_provider: { id: fallbackId },
      source: "operational_default"
    });
    await expect(
      service.setDefaultProvider({ userId, providerId: disabledId })
    ).rejects.toEqual(
      expect.objectContaining<Partial<PersonalizationApiError>>({
        code: "INVALID_PROVIDER",
        status: 422
      })
    );
  });

  it("selects multiple defaults, no-default fallback, and an empty active set deterministically", async () => {
    await Promise.all([
      createProvider(prisma, {
        id: "order-z",
        name: "Zulu Provider",
        displayOrder: 5,
        isDefault: true
      }),
      createProvider(prisma, {
        id: "order-b",
        name: "Beta Provider",
        displayOrder: 1,
        isDefault: true
      }),
      createProvider(prisma, {
        id: "order-a",
        name: "Alpha Provider",
        displayOrder: 1,
        isDefault: true
      })
    ]);
    const userId = await createUser(prisma, "preference-order@example.com");
    const service = createUserPreferenceService(
      createPrismaUserPreferenceRepository(prisma)
    );

    await expect(service.get({ userId })).resolves.toMatchObject({
      default_provider: { id: "order-a" },
      source: "operational_default"
    });

    await prisma.karaokeProvider.updateMany({ data: { isDefault: false } });
    await expect(service.get({ userId })).resolves.toMatchObject({
      default_provider: { id: "order-a" },
      source: "operational_default"
    });

    await prisma.karaokeProvider.updateMany({ data: { isActive: false } });
    await expect(service.get({ userId })).resolves.toEqual({
      default_provider: null,
      source: "none"
    });
  });

  it("serializes concurrent PUT-equivalent writes without broken foreign keys", async () => {
    const providerIds = await Promise.all(
      Array.from({ length: 3 }, (_, index) =>
        createProvider(prisma, {
          id: `concurrent-provider-${index}`,
          name: `Concurrent Provider ${index}`,
          displayOrder: index
        })
      )
    );
    const userId = await createUser(
      prisma,
      "preference-concurrent@example.com"
    );
    const service = createUserPreferenceService(
      createPrismaUserPreferenceRepository(prisma)
    );

    const results = await Promise.allSettled(
      Array.from({ length: 30 }, (_, index) =>
        service.setDefaultProvider({
          userId,
          providerId: providerIds[index % providerIds.length]
        })
      )
    );

    expect(results.every(({ status }) => status === "fulfilled")).toBe(true);
    const stored = await prisma.userPreference.findUnique({
      where: { userId },
      select: { defaultProviderId: true }
    });
    expect(providerIds).toContain(stored?.defaultProviderId);
    await expect(service.get({ userId })).resolves.toMatchObject({
      default_provider: {
        id: expect.stringMatching(/^concurrent-provider-/u)
      },
      source: "user"
    });
  });

  it.each(["delete", "deactivate"] as const)(
    "maps a provider %s race to the fixed invalid-provider outcome",
    async (mutationKind) => {
      const providerId = await createProvider(prisma, {
        id: `race-${mutationKind}-provider`,
        name: `Race ${mutationKind} Provider`,
        displayOrder: 10
      });
      const userId = await createUser(
        prisma,
        `preference-race-${mutationKind}@example.com`
      );
      const service = createUserPreferenceService(
        createPrismaUserPreferenceRepository(prisma)
      );
      const providerMutation = startLockedProviderMutation(
        prisma,
        providerId,
        mutationKind
      );

      await providerMutation.locked;
      const writeOutcome = service
        .setDefaultProvider({ userId, providerId })
        .then(
          (value) => ({ status: "fulfilled" as const, value }),
          (reason: unknown) => ({ status: "rejected" as const, reason })
        );

      try {
        await waitForBlockedProviderWrite(prisma);
      } finally {
        providerMutation.release();
      }

      await expect(providerMutation.completed).resolves.toBeUndefined();
      await expect(writeOutcome).resolves.toEqual({
        status: "rejected",
        reason: expect.objectContaining<Partial<PersonalizationApiError>>({
          code: "INVALID_PROVIDER",
          status: 422
        })
      });
      await expect(
        prisma.userPreference.count({ where: { userId } })
      ).resolves.toBe(0);
    }
  );
});

function startLockedProviderMutation(
  prisma: PrismaClient,
  providerId: string,
  mutationKind: "delete" | "deactivate"
) {
  let markLocked!: () => void;
  let releaseMutation!: () => void;
  const locked = new Promise<void>((resolve) => {
    markLocked = resolve;
  });
  const mutationReleased = new Promise<void>((resolve) => {
    releaseMutation = resolve;
  });
  const completed = prisma.$transaction(
    async (transaction) => {
      await transaction.$queryRaw`
        SELECT "id"
        FROM "karaoke_providers"
        WHERE "id" = ${providerId}
        FOR UPDATE
      `;
      markLocked();
      await mutationReleased;

      if (mutationKind === "delete") {
        await transaction.karaokeProvider.delete({ where: { id: providerId } });
        return;
      }

      await transaction.karaokeProvider.update({
        where: { id: providerId },
        data: { isActive: false }
      });
    },
    { timeout: 10_000 }
  );

  return {
    completed,
    locked,
    release: releaseMutation
  };
}

async function waitForBlockedProviderWrite(
  prisma: PrismaClient
): Promise<void> {
  const timeoutAt = Date.now() + 2_000;

  while (Date.now() < timeoutAt) {
    const waiting = await prisma.$queryRaw<Array<{ waiting: number }>>`
      SELECT 1 AS "waiting"
      FROM "pg_stat_activity"
      WHERE "pid" <> pg_backend_pid()
        AND "datname" = current_database()
        AND "wait_event_type" = 'Lock'
        AND "query" ILIKE '%karaoke_providers%'
        AND "query" ILIKE '%FOR UPDATE%'
      LIMIT 1
    `;

    if (waiting.length > 0) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error("Preference write did not wait on the provider row lock.");
}

async function createUser(
  prisma: PrismaClient,
  email: string
): Promise<string> {
  const user = await prisma.user.create({
    data: {
      name: "User Preference Test User",
      email,
      emailVerified: true
    },
    select: { id: true }
  });
  return user.id;
}

async function createProvider(
  prisma: PrismaClient,
  input: {
    id: string;
    name: string;
    displayOrder: number;
    isDefault?: boolean;
  }
): Promise<string> {
  const provider = await prisma.karaokeProvider.create({
    data: {
      id: input.id,
      name: input.name,
      country: "KR",
      isActive: true,
      displayOrder: input.displayOrder,
      isDefault: input.isDefault ?? false,
      verifiedBy: "m3-t05-integration-test"
    },
    select: { id: true }
  });
  return provider.id;
}
