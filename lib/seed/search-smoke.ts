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

export type SearchSmokeReportEntry = {
  level: "info" | "error";
  text: string;
};

export type SearchSmokeDbClient = {
  songAlias: {
    findMany(args: SearchSmokeFindManyArgs): Promise<SearchSmokeAliasRow[]>;
  };
};

export type SearchSmokeFindManyArgs = {
  where: {
    OR: SearchSmokeAliasCondition[];
    songId?: string;
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
const EXPECTED_MATCH_TAKE = 1;
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

  validateRowLengths(fixturePath, rows);

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

    if (
      !matchedSongIds.includes(smokeCase.expectedSongId) &&
      !(await searchImportedSeedHasExpectedSong(db, smokeCase))
    ) {
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
  const conditions = buildSearchSmokeAliasConditions(query);

  if (conditions.length === 0) {
    return [];
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

async function searchImportedSeedHasExpectedSong(
  db: SearchSmokeDbClient,
  smokeCase: SearchSmokeCase
): Promise<boolean> {
  const conditions = buildSearchSmokeAliasConditions(smokeCase.query);

  if (conditions.length === 0) {
    return false;
  }

  const aliases = await db.songAlias.findMany({
    where: {
      songId: smokeCase.expectedSongId,
      OR: conditions
    },
    select: { songId: true },
    orderBy: [{ songId: "asc" }, { id: "asc" }],
    take: EXPECTED_MATCH_TAKE
  });

  return aliases.length > 0;
}

function buildSearchSmokeAliasConditions(
  query: string
): SearchSmokeAliasCondition[] {
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

  return conditions;
}

export function formatSearchSmokeResult(
  result: SearchSmokeResult
): SearchSmokeReportEntry[] {
  const entries: SearchSmokeReportEntry[] = [
    { level: "info", text: `Search smoke fixture: ${result.fixturePath}` },
    { level: "info", text: `Search smoke cases: ${result.cases.length}` }
  ];

  if (result.failures.length === 0) {
    entries.push({ level: "info", text: "Search smoke passed." });
    return entries;
  }

  entries.push({
    level: "error",
    text: `Search smoke failed: ${result.failures.length} failure(s).`
  });

  for (const failure of result.failures) {
    const matched =
      failure.matchedSongIds.length === 0
        ? "(none)"
        : failure.matchedSongIds.join(", ");
    const label =
      failure.case.label === null ? "" : ` label=${failure.case.label}`;

    entries.push({
      level: "error",
      text: `failure: row=${failure.case.row}${label} query=${JSON.stringify(failure.case.query)} expected_song_id=${failure.case.expectedSongId} matched_song_ids=${matched}`
    });
  }

  return entries;
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

function validateRowLengths(
  fixturePath: string,
  rows: readonly string[][]
): void {
  for (const [index, row] of rows.slice(1).entries()) {
    if (row.length === 1 && row[0]?.trim() === "") {
      continue;
    }

    if (row.length !== SEARCH_SMOKE_HEADERS.length) {
      throw new Error(
        `${fixturePath} row ${index + 2}: expected ${SEARCH_SMOKE_HEADERS.length} columns but found ${row.length}`
      );
    }
  }
}

function uniqueSongIds(songIds: readonly string[]): string[] {
  return [...new Set(songIds)];
}

function nullableString(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function normalizeChosungQuery(input: string): string {
  // Keep NFC here: NFKC rewrites Hangul compatibility jamo such as "ㅍㅅ",
  // which must stay byte-compatible with stored chosung_alias values.
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
