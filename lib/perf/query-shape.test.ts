import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type { SearchAliasCondition } from "../search/search";
import {
  runPerfQueryShape,
  type PerfQueryShapeDbClient,
  type PerfQueryShapeSqlLog
} from "./query-shape";

const FIXTURES_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "seed",
  "__fixtures__",
  "search-smoke"
);

describe("runPerfQueryShape", () => {
  it("records client method counts, SQL event counts, and relation load evidence", async () => {
    const sqlLog: PerfQueryShapeSqlLog = { events: [] };
    const report = await runPerfQueryShape(
      fakeDb(() => sqlLog),
      {
        dbLabel: "test-local",
        datasetLabel: "current-seed-test",
        fixturePath: path.join(FIXTURES_DIR, "valid.csv"),
        caseLimit: 1,
        commit: "commit-sha",
        branch: "codex/test",
        runStartedAt: "2026-07-06T00:00:00.000Z"
      },
      sqlLog
    );
    const searchScenario = report.scenarios.find(
      (scenario) => scenario.id === "service.search.hangul-display-title-01"
    );

    expect(report.run.db_label).toBe("test-local");
    expect(report.dataset.current_seed_counts).toEqual({
      songs: 1,
      song_aliases: 3,
      karaoke_entries: 1,
      karaoke_providers: 1
    });
    expect(searchScenario).toEqual(
      expect.objectContaining({
        endpoint: "searchSongs",
        client_method_count: expect.objectContaining({
          by_query_shape: expect.objectContaining({
            "karaoke_providers.active_for_search": 1,
            "song_aliases.candidate.normalized_alias.equals": 1,
            "song_aliases.candidate.normalized_alias.starts_with": 1,
            "song_aliases.id_in.detail_with_relations": 1
          })
        }),
        actual_sql_query_count: expect.objectContaining({
          available: true,
          total: expect.any(Number)
        }),
        candidate_alias_id_group_count: 2,
        unique_alias_id_count: 1,
        relation_load_observation: expect.objectContaining({
          classification: "batched_relation_load_not_n_plus_1",
          song_relation_sql_count: 1,
          karaoke_entries_relation_sql_count: 1
        })
      })
    );
  });

  it("records suggestions and invalid provider paths separately", async () => {
    const report = await runPerfQueryShape(fakeDb(), {
      dbLabel: "test-local",
      datasetLabel: "current-seed-test",
      fixturePath: path.join(FIXTURES_DIR, "valid.csv"),
      caseLimit: 1,
      commit: "commit-sha",
      branch: "codex/test",
      runStartedAt: "2026-07-06T00:00:00.000Z"
    });
    const invalidProvider = report.scenarios.find(
      (scenario) => scenario.id === "api.search.invalid-provider"
    );
    const noResult = report.scenarios.find(
      (scenario) => scenario.id === "service.search.no-results-suggestions"
    );

    expect(invalidProvider).toEqual(
      expect.objectContaining({
        status: 400,
        client_method_count: expect.objectContaining({
          by_query_shape: {
            "karaoke_providers.active_for_search": 1
          }
        })
      })
    );
    expect(noResult).toEqual(
      expect.objectContaining({
        endpoint: "searchSongs",
        client_method_count: expect.objectContaining({
          by_query_shape: expect.objectContaining({
            "song_aliases.suggestions": 1
          })
        }),
        actual_sql_query_count: expect.objectContaining({ available: false })
      })
    );
  });
});

function fakeDb(
  getSqlLog?: () => PerfQueryShapeSqlLog | undefined
): PerfQueryShapeDbClient {
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
      findMany: async () => {
        pushSql(getSqlLog, "SELECT * FROM karaoke_providers");

        return [provider];
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
          pushSql(getSqlLog, "SELECT * FROM song_aliases WHERE id IN ($1)");
          pushSql(getSqlLog, "SELECT * FROM songs WHERE id IN ($1)");
          pushSql(
            getSqlLog,
            "SELECT * FROM karaoke_entries WHERE song_id IN ($1)"
          );

          return [fullAlias];
        }

        pushSql(
          getSqlLog,
          "SELECT id FROM song_aliases WHERE normalized_alias ILIKE $1"
        );

        if (hasOrWhere(where)) {
          return [];
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

  return (
    row.chosungAlias?.startsWith(condition.chosungAlias.startsWith) ?? false
  );
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

function pushSql(
  getSqlLog: (() => PerfQueryShapeSqlLog | undefined) | undefined,
  query: string
) {
  const sqlLog = getSqlLog?.();

  if (sqlLog === undefined) {
    return;
  }

  sqlLog.events.push({
    query,
    duration: 1,
    target: "test"
  });
}
