import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type { SearchAliasCondition } from "../search/search";
import { runPerfBaseline, type PerfBaselineDbClient } from "./baseline";

const FIXTURES_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "seed",
  "__fixtures__",
  "search-smoke"
);

describe("runPerfBaseline", () => {
  it("measures API and service scenarios from the search smoke fixture", async () => {
    const report = await runPerfBaseline(fakeDb(), {
      dbLabel: "test-local",
      datasetLabel: "current-seed-test",
      fixturePath: path.join(FIXTURES_DIR, "valid.csv"),
      iterations: 2,
      warmup: 1,
      commit: "commit-sha",
      branch: "develop",
      runStartedAt: "2026-07-06T00:00:00.000Z"
    });

    expect(report.run.db_label).toBe("test-local");
    expect(report.dataset.current_seed_counts).toEqual({
      songs: 1,
      song_aliases: 3,
      karaoke_entries: 1,
      karaoke_providers: 1
    });
    expect(report.dataset.scale_scenario).toBe("current_seed");
    expect(report.scenarios).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          target: "service",
          endpoint: "searchSongs",
          dataset_label: "current-seed-test",
          query_count: expect.objectContaining({ p50: expect.any(Number) })
        }),
        expect.objectContaining({
          target: "api",
          endpoint: "GET /api/search",
          status: 200,
          response_size_bytes: expect.objectContaining({
            p50: expect.any(Number)
          })
        }),
        expect.objectContaining({
          target: "service",
          endpoint: "listProviders"
        }),
        expect.objectContaining({
          target: "api",
          endpoint: "GET /api/providers",
          status: 200
        }),
        expect.objectContaining({
          id: "api.search.invalid-provider",
          status: 400
        })
      ])
    );
  });

  it("rejects invalid iteration counts before measuring scenarios", async () => {
    await expect(
      runPerfBaseline(fakeDb(), {
        dbLabel: "test-local",
        datasetLabel: "current-seed-test",
        fixturePath: path.join(FIXTURES_DIR, "valid.csv"),
        iterations: 0,
        warmup: 1,
        commit: "commit-sha",
        branch: "develop",
        runStartedAt: "2026-07-06T00:00:00.000Z"
      })
    ).rejects.toThrow("iterations must be a positive integer.");
  });

  it("marks synthetic datasets as synthetic future scale runs", async () => {
    const report = await runPerfBaseline(fakeDb(), {
      dbLabel: "test-local",
      datasetLabel: "synthetic-10k-songs-100k-aliases",
      fixturePath: path.join(FIXTURES_DIR, "valid.csv"),
      iterations: 1,
      warmup: 0,
      commit: "commit-sha",
      branch: "develop",
      runStartedAt: "2026-07-06T00:00:00.000Z"
    });

    expect(report.dataset.scale_scenario).toBe("synthetic_future");
  });

  it("keeps search scenario IDs distinct when labels share a slug", async () => {
    const report = await runPerfBaseline(fakeDb(), {
      dbLabel: "test-local",
      datasetLabel: "current-seed-test",
      fixturePath: path.join(FIXTURES_DIR, "duplicate-slugs.csv"),
      iterations: 1,
      warmup: 0,
      commit: "commit-sha",
      branch: "develop",
      runStartedAt: "2026-07-06T00:00:00.000Z"
    });
    const searchScenarioIds = report.scenarios
      .filter((scenario) => scenario.id.startsWith("service.search.duplicate"))
      .map((scenario) => scenario.id);

    expect(searchScenarioIds).toEqual([
      "service.search.duplicate-label-01",
      "service.search.duplicate-label-02"
    ]);
  });
});

function fakeDb(): PerfBaselineDbClient {
  const provider = {
    id: "provider_alpha",
    name: "Generic Provider Alpha",
    country: "KR",
    isActive: true,
    displayOrder: 10,
    isDefault: true,
    lastCatalogUpdatedAt: null
  };
  const aliasRows = [
    alias("alias_fixture_001_ko", "픽스처노래", "ㅍㅅㅊㄴㄹ"),
    alias("alias_fixture_001_ro", "fixturesong", null),
    alias("alias_fixture_001_content", "fixtureseriesop", null)
  ];
  const fullAlias = {
    id: "alias_fixture_001_ko",
    songId: "song_fixture_001",
    alias: "픽스처 노래",
    language: "ko",
    aliasType: "display_title",
    normalizedAlias: "픽스처노래",
    chosungAlias: "ㅍㅅㅊㄴㄹ",
    song: {
      id: "song_fixture_001",
      originalLanguage: "ja",
      canonicalTitle: "Fixture Song",
      displayTitle: "픽스처 노래",
      canonicalArtist: "Fixture Artist",
      releaseYear: 2026,
      tieIn: "Fixture Series",
      karaokeEntries: [
        {
          id: "entry_fixture_001_alpha",
          providerId: "provider_alpha",
          karaokeNumber: "12345",
          versionInfo: "original",
          availabilityStatus: "available",
          lastVerifiedAt: "2026-07-01"
        }
      ]
    }
  };

  return {
    karaokeProvider: {
      findMany: async (args) => {
        const query = args as { where: { isActive?: boolean } };

        return query.where.isActive === false ? [] : [provider];
      }
    },
    songAlias: {
      findMany: async (args) => {
        const query = args as {
          where:
            | { id: { in: string[] } }
            | { OR: SearchAliasCondition[] }
            | SearchAliasCondition;
          select: Record<string, true>;
        };

        const where = query.where;

        if (hasIdWhere(where)) {
          return [fullAlias];
        }

        if (hasOrWhere(where)) {
          const matched = aliasRows.filter((row) =>
            where.OR.some((condition) => matches(row, condition))
          );

          if ("alias" in query.select) {
            return matched.map((row) => ({
              id: row.id,
              alias: "픽스처 노래",
              normalizedAlias: row.normalizedAlias
            }));
          }

          return matched.map((row) => ({ id: row.id }));
        }

        return aliasRows
          .filter((row) => matches(row, where))
          .map((row) => ({ id: row.id }));
      },
      count: async () => 3
    },
    song: {
      count: async () => 1
    },
    karaokeEntry: {
      count: async () => 1
    }
  };
}

function alias(
  id: string,
  normalizedAlias: string,
  chosungAlias: string | null
) {
  return {
    id,
    songId: "song_fixture_001",
    normalizedAlias,
    chosungAlias
  };
}

function matches(
  row: ReturnType<typeof alias>,
  condition: SearchAliasCondition
): boolean {
  if ("normalizedAlias" in condition) {
    if ("equals" in condition.normalizedAlias) {
      return row.normalizedAlias === condition.normalizedAlias.equals;
    }

    if ("startsWith" in condition.normalizedAlias) {
      return row.normalizedAlias.startsWith(
        condition.normalizedAlias.startsWith
      );
    }

    return row.normalizedAlias.includes(condition.normalizedAlias.contains);
  }

  if ("chosungAlias" in condition) {
    return (
      row.chosungAlias?.startsWith(condition.chosungAlias.startsWith) ?? false
    );
  }

  return false;
}

type FakeSearchAliasWhere =
  | { id: { in: string[] } }
  | { OR: SearchAliasCondition[] }
  | SearchAliasCondition;

function hasIdWhere(where: FakeSearchAliasWhere): where is {
  id: { in: string[] };
} {
  return "id" in where;
}

function hasOrWhere(where: FakeSearchAliasWhere): where is {
  OR: SearchAliasCondition[];
} {
  return "OR" in where;
}
