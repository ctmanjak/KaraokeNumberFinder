import { existsSync, readFileSync } from "node:fs";

import {
  canUseHangulChosungSearch,
  normalizeSearchText
} from "../search/normalize";
import { parseCsv, recordsFromCsvRows, type CsvRecord } from "./csv";

export type SearchSmokeCase = {
  row: number;
  query: string;
  expectedSongId: string;
  label: string | null;
};

export type SearchSmokeMatch = {
  songId: string;
};

export type SearchSmokeFailure = {
  case: SearchSmokeCase;
  matchedSongIds: string[];
};

export type SearchSmokeResult = {
  fixturePath: string;
  cases: SearchSmokeCase[];
  failures: SearchSmokeFailure[];
};

export type SearchSmokeDbClient = {
  songAlias: {
    findMany(args: SearchSmokeFindManyArgs): Promise<SearchSmokeAliasRow[]>;
  };
};

export type SearchSmokeFindManyArgs = {
  where: {
    OR: SearchSmokeAliasCondition[];
  };
  select: {
    songId: true;
  };
  orderBy: [{ songId: "asc" }, { id: "asc" }];
  take: number;
};

export type SearchSmokeAliasCondition =
  | {
      normalizedAlias: {
        equals: string;
      };
    }
  | {
      normalizedAlias: {
        startsWith: string;
      };
    }
  | {
      normalizedAlias: {
        contains: string;
      };
    }
  | {
      chosungAlias: {
        startsWith: string;
      };
    };

export type SearchSmokeAliasRow = {
  songId: string;
};

const DEFAULT_TAKE = 50;
const SEARCH_SMOKE_HEADERS = ["query", "expected_song_id", "label"] as const;
const SEARCH_WEAK_SYMBOL_PATTERN = /[-_・.'!?]/gu;
const BRACKET_SYMBOL_PATTERN = /[()[\]{}]/gu;
const WHITESPACE_PATTERN = /\s+/gu;

export function readSearchSmokeCases(fixturePath: string): SearchSmokeCase[] {
  if (!existsSync(fixturePath)) {
    throw new Error(`fixture not found: ${fixturePath}`);
  }

  const text = readFileSync(fixturePath, "utf8").replace(/^\uFEFF/u, "");
  let rows: string[][];

  try {
    rows = parseCsv(text);
  } catch (error) {
    throw new Error(`invalid CSV: ${errorMessage(error)}`);
  }

  const actualHeader = rows[0] ?? [];

  if (!sameHeader(actualHeader, SEARCH_SMOKE_HEADERS)) {
    throw new Error(
      `header must be ${SEARCH_SMOKE_HEADERS.join(",")} in ${fixturePath}`
    );
  }

  return recordsFromCsvRows(SEARCH_SMOKE_HEADERS, rows).map(parseCaseRecord);
}

export async function runSearchSmoke(
  db: SearchSmokeDbClient,
  fixturePath = "seed/search-smoke.csv"
): Promise<SearchSmokeResult> {
  const cases = readSearchSmokeCases(fixturePath);
  const failures: SearchSmokeFailure[] = [];

  for (const smokeCase of cases) {
    const matches = await searchImportedSeedSongs(db, smokeCase.query);
    const matchedSongIds = matches.map((match) => match.songId);

    if (!matchedSongIds.includes(smokeCase.expectedSongId)) {
      failures.push({ case: smokeCase, matchedSongIds });
    }
  }

  return { fixturePath, cases, failures };
}

export async function searchImportedSeedSongs(
  db: SearchSmokeDbClient,
  query: string,
  options: { take?: number } = {}
): Promise<SearchSmokeMatch[]> {
  const normalizedQuery = normalizeSearchText(query);

  if (normalizedQuery.length === 0) {
    return [];
  }

  const conditions: SearchSmokeAliasCondition[] = [
    { normalizedAlias: { equals: normalizedQuery } },
    { normalizedAlias: { startsWith: normalizedQuery } },
    { normalizedAlias: { contains: normalizedQuery } }
  ];

  const chosungQuery = normalizeChosungQuery(query);

  if (canUseHangulChosungSearch(chosungQuery)) {
    conditions.push({ chosungAlias: { startsWith: chosungQuery } });
  }

  const aliases = await db.songAlias.findMany({
    where: { OR: conditions },
    select: { songId: true },
    orderBy: [{ songId: "asc" }, { id: "asc" }],
    take: options.take ?? DEFAULT_TAKE
  });

  return uniqueSongIds(aliases.map((alias) => alias.songId)).map((songId) => ({
    songId
  }));
}

export function formatSearchSmokeResult(result: SearchSmokeResult): string[] {
  const lines = [
    `Search smoke fixture: ${result.fixturePath}`,
    `Search smoke cases: ${result.cases.length}`
  ];

  if (result.failures.length === 0) {
    lines.push("Search smoke passed.");
    return lines;
  }

  lines.push(`Search smoke failed: ${result.failures.length} failure(s).`);

  for (const failure of result.failures) {
    const matched =
      failure.matchedSongIds.length === 0
        ? "(none)"
        : failure.matchedSongIds.join(", ");
    const label =
      failure.case.label === null ? "" : ` label=${failure.case.label}`;

    lines.push(
      `failure: row=${failure.case.row}${label} query=${JSON.stringify(failure.case.query)} expected_song_id=${failure.case.expectedSongId} matched_song_ids=${matched}`
    );
  }

  return lines;
}

function parseCaseRecord(record: CsvRecord): SearchSmokeCase {
  const query = record.values.query.trim();
  const expectedSongId = record.values.expected_song_id.trim();
  const label = nullableString(record.values.label);

  if (query === "") {
    throw new Error(`row ${record.rowNumber}: query is required`);
  }

  if (expectedSongId === "") {
    throw new Error(`row ${record.rowNumber}: expected_song_id is required`);
  }

  return { row: record.rowNumber, query, expectedSongId, label };
}

function uniqueSongIds(songIds: readonly string[]): string[] {
  return [...new Set(songIds)];
}

function nullableString(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function normalizeChosungQuery(input: string): string {
  return input
    .trim()
    .normalize("NFC")
    .toLowerCase()
    .replace(BRACKET_SYMBOL_PATTERN, "")
    .replace(SEARCH_WEAK_SYMBOL_PATTERN, "")
    .replace(WHITESPACE_PATTERN, "");
}

function sameHeader(
  actual: readonly string[],
  expected: readonly string[]
): boolean {
  return (
    actual.length === expected.length &&
    expected.every((column, index) => actual[index] === column)
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
