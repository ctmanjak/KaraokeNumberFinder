import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  formatSearchSmokeResult,
  readSearchSmokeCases,
  runSearchSmoke,
  searchImportedSeedSongs,
  type SearchSmokeAliasRow,
  type SearchSmokeDbClient,
  type SearchSmokeFindManyArgs
} from "./search-smoke";

const FIXTURES_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "__fixtures__",
  "search-smoke"
);

describe("readSearchSmokeCases", () => {
  it("reads the fixture cases", () => {
    expect(readSearchSmokeCases(path.join(FIXTURES_DIR, "valid.csv"))).toEqual([
      {
        row: 2,
        query: "픽스처 노래",
        expectedSongId: "song_fixture_001",
        label: "hangul display title"
      },
      {
        row: 3,
        query: "Fixture Song",
        expectedSongId: "song_fixture_001",
        label: "romanized title"
      },
      {
        row: 4,
        query: "Fixture Series",
        expectedSongId: "song_fixture_001",
        label: "content alias"
      },
      {
        row: 5,
        query: "ㅍㅅ",
        expectedSongId: "song_fixture_001",
        label: "hangul chosung"
      }
    ]);
  });

  it("rejects malformed fixtures", () => {
    expect(() =>
      readSearchSmokeCases(path.join(FIXTURES_DIR, "invalid.csv"))
    ).toThrow("row 2: expected_song_id is required");
  });

  it("rejects fixture rows with an unexpected column count", () => {
    expect(() =>
      readSearchSmokeCases(path.join(FIXTURES_DIR, "extra-column.csv"))
    ).toThrow("row 2: expected 3 columns but found 4");
  });
});

describe("searchImportedSeedSongs", () => {
  it("matches Hangul display names", async () => {
    await expect(
      searchImportedSeedSongs(fakeDb(), "픽스처 노래")
    ).resolves.toEqual([{ songId: "song_fixture_001" }]);
  });

  it("matches romanized aliases after normalization", async () => {
    await expect(
      searchImportedSeedSongs(fakeDb(), "fixture-song")
    ).resolves.toEqual([{ songId: "song_fixture_001" }]);
  });

  it("matches content aliases by partial normalized alias", async () => {
    await expect(searchImportedSeedSongs(fakeDb(), "Series")).resolves.toEqual([
      { songId: "song_fixture_001" }
    ]);
  });

  it("matches Hangul chosung aliases only from two initials", async () => {
    await expect(searchImportedSeedSongs(fakeDb(), "ㅍㅅ")).resolves.toEqual([
      { songId: "song_fixture_001" }
    ]);
    await expect(searchImportedSeedSongs(fakeDb(), "ㅍ")).resolves.toEqual([]);
  });
});

describe("runSearchSmoke", () => {
  it("passes when expected song IDs are included in matches", async () => {
    const result = await runSearchSmoke(
      fakeDb(),
      path.join(FIXTURES_DIR, "valid.csv")
    );

    expect(result.failures).toEqual([]);
  });

  it("reports the query, expected song ID, and matched song IDs on failure", async () => {
    const result = await runSearchSmoke(
      fakeDb(),
      path.join(FIXTURES_DIR, "failure.csv")
    );

    expect(result.failures).toHaveLength(1);
    expect(formatSearchSmokeResult(result)).toContainEqual({
      level: "error",
      text: 'failure: row=2 label=mismatch query="픽스처 노래" expected_song_id=song_missing matched_song_ids=song_fixture_001'
    });
  });

  it("checks the expected song directly when the display match list is capped", async () => {
    const result = await runSearchSmoke(
      fakeDbWithManyPrefixMatches(),
      path.join(FIXTURES_DIR, "valid.csv")
    );

    expect(result.failures).toEqual([]);
  });
});

type FakeAlias = SearchSmokeAliasRow & {
  id: string;
  normalizedAlias: string;
  chosungAlias: string | null;
};

function fakeDb(): SearchSmokeDbClient {
  const aliases: FakeAlias[] = [
    {
      id: "alias_fixture_001_ko",
      songId: "song_fixture_001",
      normalizedAlias: "픽스처노래",
      chosungAlias: "ㅍㅅㅊㄴㄹ"
    },
    {
      id: "alias_fixture_001_ro",
      songId: "song_fixture_001",
      normalizedAlias: "fixturesong",
      chosungAlias: null
    },
    {
      id: "alias_fixture_001_content",
      songId: "song_fixture_001",
      normalizedAlias: "fixtureseriesop",
      chosungAlias: null
    }
  ];

  return {
    songAlias: {
      findMany: async (args) =>
        aliases
          .filter((alias) => matches(alias, args))
          .sort(compareAlias)
          .slice(0, args.take)
          .map((alias) => ({ songId: alias.songId }))
    }
  };
}

function fakeDbWithManyPrefixMatches(): SearchSmokeDbClient {
  const db = fakeDb();
  const aliases = Array.from({ length: 55 }, (_, index): FakeAlias => {
    const id = String(index + 1).padStart(3, "0");

    return {
      id: `alias_other_${id}`,
      songId: `song_other_${id}`,
      normalizedAlias: "픽스처노래",
      chosungAlias: "ㅍㅅㅊㄴㄹ"
    };
  });

  return {
    songAlias: {
      findMany: async (args) => {
        const baseRows = await db.songAlias.findMany({
          ...args,
          take: Number.MAX_SAFE_INTEGER
        });
        const rows = [
          ...aliases
            .filter((alias) => matches(alias, args))
            .sort(compareAlias)
            .map((alias) => ({ songId: alias.songId })),
          ...baseRows
        ];

        return rows.slice(0, args.take);
      }
    }
  };
}

function matches(alias: FakeAlias, args: SearchSmokeFindManyArgs): boolean {
  if (args.where.songId !== undefined && alias.songId !== args.where.songId) {
    return false;
  }

  return args.where.OR.some((condition) => {
    if ("normalizedAlias" in condition) {
      if ("equals" in condition.normalizedAlias) {
        return alias.normalizedAlias === condition.normalizedAlias.equals;
      }

      if ("startsWith" in condition.normalizedAlias) {
        return alias.normalizedAlias.startsWith(
          condition.normalizedAlias.startsWith
        );
      }

      return alias.normalizedAlias.includes(condition.normalizedAlias.contains);
    }

    return alias.chosungAlias?.startsWith(condition.chosungAlias.startsWith);
  });
}

function compareAlias(left: FakeAlias, right: FakeAlias): number {
  return (
    left.songId.localeCompare(right.songId) || left.id.localeCompare(right.id)
  );
}
