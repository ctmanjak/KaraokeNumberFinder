import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { optionalM3TestDatabaseUrl } from "../../scripts/m3/test-db-url";
import { PrismaClient } from "../generated/prisma/client";
import { createPrismaSearchHistoryRepository } from "./repository";

const testDatabaseUrl = optionalM3TestDatabaseUrl(
  process.env.M3_TEST_DATABASE_URL
);
const describeDatabase =
  testDatabaseUrl === undefined ? describe.skip : describe;

describeDatabase("search history repository on PostgreSQL", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: testDatabaseUrl, max: 20 })
    });
  });

  beforeEach(async () => {
    await prisma.searchHistory.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("uses the user-normalized unique key for concurrent upsert and isolates users", async () => {
    const userId = await createUser(prisma, "history-a@example.com");
    const otherUserId = await createUser(prisma, "history-b@example.com");
    const repository = createPrismaSearchHistoryRepository(prisma, {
      now: monotonicClock()
    });

    await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        repository.save(
          {
            userId,
            query: `Hello display ${index}`,
            normalizedQuery: "hello"
          },
          10
        )
      )
    );
    await repository.save(
      {
        userId: otherUserId,
        query: "Other user's Hello",
        normalizedQuery: "hello"
      },
      10
    );

    const [ownerRows, otherRows, totalRows] = await Promise.all([
      repository.list({ userId }, 10),
      repository.list({ userId: otherUserId }, 10),
      prisma.searchHistory.count()
    ]);

    expect(ownerRows).toHaveLength(1);
    expect(ownerRows[0].normalizedQuery).toBe("hello");
    expect(ownerRows[0].query).toMatch(/^Hello display \d+$/u);
    expect(otherRows).toMatchObject([
      { query: "Other user's Hello", normalizedQuery: "hello" }
    ]);
    expect(totalRows).toBe(2);
  });

  it("updates the display query and searched time on a repeated normalized query", async () => {
    const userId = await createUser(prisma, "history-repeat@example.com");
    const repository = createPrismaSearchHistoryRepository(prisma, {
      now: monotonicClock()
    });

    const first = await repository.save(
      { userId, query: "First Display", normalizedQuery: "same" },
      10
    );
    const repeated = await repository.save(
      { userId, query: "Latest Display", normalizedQuery: "same" },
      10
    );

    expect(repeated.id).toBe(first.id);
    expect(repeated.query).toBe("Latest Display");
    expect(repeated.searchedAt.getTime()).toBeGreaterThan(
      first.searchedAt.getTime()
    );
    await expect(
      prisma.searchHistory.count({ where: { userId } })
    ).resolves.toBe(1);
  });

  it("keeps the newest ten after eleven or more sequential saves", async () => {
    const userId = await createUser(prisma, "history-prune@example.com");
    const repository = createPrismaSearchHistoryRepository(prisma, {
      now: monotonicClock()
    });

    for (let index = 0; index < 12; index += 1) {
      await repository.save(
        {
          userId,
          query: `Query ${index}`,
          normalizedQuery: `query${index}`
        },
        10
      );
    }

    const rows = await repository.list({ userId }, 20);

    expect(rows).toHaveLength(10);
    expect(rows.map(({ query }) => query)).toEqual(
      Array.from({ length: 10 }, (_, index) => `Query ${11 - index}`)
    );
  });

  it("never leaves more than ten rows after concurrent multi-query saves", async () => {
    const userId = await createUser(prisma, "history-concurrent@example.com");
    const repository = createPrismaSearchHistoryRepository(prisma, {
      now: monotonicClock()
    });

    await Promise.all(
      Array.from({ length: 30 }, (_, index) =>
        repository.save(
          {
            userId,
            query: `Concurrent ${index}`,
            normalizedQuery: `concurrent${index}`
          },
          10
        )
      )
    );

    const rows = await repository.list({ userId }, 30);

    expect(rows).toHaveLength(10);
    expect(
      new Set(rows.map(({ normalizedQuery }) => normalizedQuery)).size
    ).toBe(10);
    await expect(
      prisma.searchHistory.count({ where: { userId } })
    ).resolves.toBe(10);
  });

  it("uses id DESC as a stable tie-break and scopes individual and bulk deletion", async () => {
    const userId = await createUser(prisma, "history-delete@example.com");
    const otherUserId = await createUser(
      prisma,
      "history-delete-other@example.com"
    );
    const searchedAt = new Date("2026-07-19T00:00:00.000Z");
    const ids = [
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
      "33333333-3333-4333-8333-333333333333"
    ];
    await prisma.searchHistory.createMany({
      data: ids.map((id, index) => ({
        id,
        userId,
        query: `Tie ${index}`,
        normalizedQuery: `tie${index}`,
        searchedAt
      }))
    });
    const other = await prisma.searchHistory.create({
      data: {
        userId: otherUserId,
        query: "Other",
        normalizedQuery: "other",
        searchedAt
      }
    });
    const repository = createPrismaSearchHistoryRepository(prisma);

    expect((await repository.list({ userId }, 10)).map(({ id }) => id)).toEqual(
      [...ids].reverse()
    );
    await expect(repository.delete({ userId, id: other.id })).resolves.toBe(0);
    await expect(
      prisma.searchHistory.count({ where: { id: other.id } })
    ).resolves.toBe(1);
    await expect(repository.clear({ userId })).resolves.toBe(3);
    await expect(
      prisma.searchHistory.count({ where: { userId: otherUserId } })
    ).resolves.toBe(1);
  });
});

async function createUser(
  prisma: PrismaClient,
  email: string
): Promise<string> {
  const user = await prisma.user.create({
    data: {
      name: "Search History Test User",
      email,
      emailVerified: true
    },
    select: { id: true }
  });
  return user.id;
}

function monotonicClock(): () => Date {
  const start = Date.parse("2026-07-19T00:00:00.000Z");
  let tick = 0;
  return () => new Date(start + tick++ * 1_000);
}
