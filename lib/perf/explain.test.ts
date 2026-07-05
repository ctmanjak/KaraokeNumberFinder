import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { runPerfExplain, type PerfExplainDbClient } from "./explain";

const FIXTURES_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "seed",
  "__fixtures__",
  "search-smoke"
);

describe("runPerfExplain", () => {
  it("summarizes read-only EXPLAIN ANALYZE plans for representative cases", async () => {
    const report = await runPerfExplain(fakeDb(), {
      dbLabel: "test-local",
      datasetLabel: "current-seed-test",
      fixturePath: path.join(FIXTURES_DIR, "valid.csv"),
      caseLimit: 1,
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
    expect(report.representative_cases).toHaveLength(1);
    expect(report.plans).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          query_shape: "song_aliases.normalized_alias.equals_insensitive",
          db_label: "test-local",
          dataset_label: "current-seed-test",
          rows_planned: 3,
          rows_scanned: 3,
          rows_filtered: 1,
          rows_returned: 2,
          index: { used: true, names: ["song_aliases_normalized_alias_idx"] },
          sequential_scan: { occurred: false, relations: [] },
          sort: { occurred: true, methods: ["quicksort"] }
        }),
        expect.objectContaining({
          query_shape: "song_aliases.id_in.detail_with_song_and_karaoke_entries"
        }),
        expect.objectContaining({
          query_shape: "GET /api/providers.active_country_order"
        })
      ])
    );
  });
});

function fakeDb(): PerfExplainDbClient {
  return {
    query: async <T extends Record<string, unknown> = Record<string, unknown>>(
      sql: string
    ) => {
      if (sql.includes("COUNT(*)::text AS count FROM songs")) {
        return rows<T>({ count: "1" });
      }

      if (sql.includes("COUNT(*)::text AS count FROM song_aliases")) {
        return rows<T>({ count: "3" });
      }

      if (sql.includes("COUNT(*)::text AS count FROM karaoke_entries")) {
        return rows<T>({ count: "1" });
      }

      if (sql.includes("COUNT(*)::text AS count FROM karaoke_providers")) {
        return rows<T>({ count: "1" });
      }

      if (sql.startsWith("SELECT country FROM karaoke_providers")) {
        return rows<T>({ country: "KR" });
      }

      if (sql.startsWith("SELECT id FROM song_aliases")) {
        return rows<T>({ id: "alias_fixture_001_ko" });
      }

      if (sql.startsWith("EXPLAIN")) {
        return rows<T>({
          "QUERY PLAN": [
            {
              Plan: {
                "Node Type": "Sort",
                "Plan Rows": 3,
                "Actual Rows": 2,
                "Actual Loops": 1,
                "Sort Method": "quicksort",
                Plans: [
                  {
                    "Node Type": "Index Scan",
                    "Index Name": "song_aliases_normalized_alias_idx",
                    "Relation Name": "song_aliases",
                    "Actual Rows": 2,
                    "Actual Loops": 1,
                    "Rows Removed by Filter": 1
                  }
                ]
              },
              "Planning Time": 0.12,
              "Execution Time": 0.34
            }
          ]
        });
      }

      throw new Error(`unexpected SQL: ${sql}`);
    }
  };
}

function rows<T extends Record<string, unknown>>(row: Record<string, unknown>) {
  return { rows: [row as T] };
}
