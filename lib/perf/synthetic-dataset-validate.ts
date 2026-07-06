import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { recordsFromCsvRows, readCsvRows, type CsvRecord } from "../seed/csv";
import { SEED_FILE_HEADERS, type SeedFileName } from "../seed/validate";
import {
  assertSyntheticValidationDbAllowed,
  type SyntheticSafeDbLabel
} from "./synthetic-import-guard";
import {
  expectedSyntheticAliasCount,
  expectedSyntheticKaraokeEntryCount,
  isSyntheticDatasetLabel,
  REQUIRED_SYNTHETIC_CASE_IDS,
  SYNTHETIC_GENERATOR_VERSION,
  SYNTHETIC_METADATA_FILE,
  SYNTHETIC_SEARCH_FIXTURE_FILE,
  syntheticDatasetConfigFor,
  type SyntheticDatasetLabel,
  type SyntheticDatasetMetadata
} from "./synthetic-dataset";

export type SyntheticDatasetValidationDbClient = {
  song: {
    count(args: { where: { verificationNote: string } }): Promise<number>;
  };
  songAlias: {
    count(args: { where: { verificationNote: string } }): Promise<number>;
  };
  karaokeEntry: {
    count(args: { where: { verificationNote: string } }): Promise<number>;
  };
  karaokeProvider: {
    count(args: { where: { verificationNote: string } }): Promise<number>;
  };
};

export type SyntheticDatasetValidationOptions = {
  seedDir: string;
  datasetLabel: string;
  filesOnly: boolean;
  dbLabel?: string;
  databaseUrl?: string;
  db?: SyntheticDatasetValidationDbClient;
};

export type SyntheticDatasetValidationReport = {
  schema_version: 1;
  dataset_label: string;
  seed_dir: string;
  mode: "files-only" | "db";
  metadata: {
    status: "pass" | "fail";
    path: string;
  };
  file_row_counts: SyntheticDatasetRowCounts;
  fixture_coverage: {
    status: "pass" | "fail";
    path: string;
    required_case_ids: string[];
    present_case_ids: string[];
  };
  db?: {
    status: "pass" | "fail";
    db_label: SyntheticSafeDbLabel;
    row_counts: SyntheticDatasetRowCounts;
  };
  errors: string[];
  warnings: string[];
};

type SyntheticDatasetRowCounts = {
  songs: number;
  song_aliases: number;
  karaoke_entries: number;
  karaoke_providers: number;
  search_fixture_cases: number;
};

type RequiredFileName =
  | SeedFileName
  | typeof SYNTHETIC_METADATA_FILE
  | typeof SYNTHETIC_SEARCH_FIXTURE_FILE;

const REQUIRED_FILES: readonly RequiredFileName[] = [
  SYNTHETIC_METADATA_FILE,
  SYNTHETIC_SEARCH_FIXTURE_FILE,
  "songs.csv",
  "song_aliases.csv",
  "karaoke_entries.csv",
  "karaoke_providers.csv"
];

const SEARCH_FIXTURE_HEADERS = [
  "case_id",
  "label",
  "query",
  "expected_song_id",
  "expected_match_type",
  "provider_id",
  "dataset_label",
  "notes"
] as const;

const EMPTY_ROW_COUNTS: SyntheticDatasetRowCounts = {
  songs: 0,
  song_aliases: 0,
  karaoke_entries: 0,
  karaoke_providers: 0,
  search_fixture_cases: 0
};

export async function validateSyntheticDataset(
  options: SyntheticDatasetValidationOptions
): Promise<SyntheticDatasetValidationReport> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const metadataPath = path.join(options.seedDir, SYNTHETIC_METADATA_FILE);
  const fixturePath = path.join(options.seedDir, SYNTHETIC_SEARCH_FIXTURE_FILE);
  const report: SyntheticDatasetValidationReport = {
    schema_version: 1,
    dataset_label: options.datasetLabel,
    seed_dir: options.seedDir,
    mode: options.filesOnly ? "files-only" : "db",
    metadata: {
      status: "fail",
      path: metadataPath
    },
    file_row_counts: { ...EMPTY_ROW_COUNTS },
    fixture_coverage: {
      status: "fail",
      path: fixturePath,
      required_case_ids: [...REQUIRED_SYNTHETIC_CASE_IDS],
      present_case_ids: []
    },
    errors,
    warnings
  };

  if (!isSyntheticDatasetLabel(options.datasetLabel)) {
    errors.push(`unsupported dataset_label ${options.datasetLabel}`);
    return report;
  }

  const config = syntheticDatasetConfigFor(options.datasetLabel);

  for (const file of REQUIRED_FILES) {
    if (!existsSync(path.join(options.seedDir, file))) {
      errors.push(`${file} is required`);
    }
  }

  const metadata = readMetadata(metadataPath, errors);
  if (metadata !== null) {
    validateMetadata(metadata, config.label, errors);
  }

  const seedRows = readSeedFiles(options.seedDir, errors);
  const fixtureRows = readFixtureRows(fixturePath, errors);

  report.file_row_counts = {
    songs: seedRows["songs.csv"].length,
    song_aliases: seedRows["song_aliases.csv"].length,
    karaoke_entries: seedRows["karaoke_entries.csv"].length,
    karaoke_providers: seedRows["karaoke_providers.csv"].length,
    search_fixture_cases: fixtureRows.length
  };

  validateFileRowCounts(report.file_row_counts, config.label, errors);

  if (metadata !== null) {
    validateMetadataRowCounts(metadata, report.file_row_counts, errors);
  }

  const fixtureCaseIds = validateFixtureRows(fixtureRows, config.label, errors);
  report.fixture_coverage.present_case_ids = [...fixtureCaseIds].sort();
  report.fixture_coverage.status = hasFixtureErrors(errors) ? "fail" : "pass";

  if (!options.filesOnly) {
    const guard = assertSyntheticValidationDbAllowed({
      dbLabel: options.dbLabel,
      databaseUrl: options.databaseUrl
    });

    if (options.db === undefined) {
      throw new Error("Synthetic dataset DB validation requires a DB client.");
    }

    const dbRowCounts = await readDbRowCounts(options.db, config.label);
    const dbStatus = validateDbRowCounts(dbRowCounts, config.label, errors)
      ? "pass"
      : "fail";
    report.db = {
      status: dbStatus,
      db_label: guard.targetLabel,
      row_counts: dbRowCounts
    };
  }

  report.metadata.status = hasMetadataErrors(errors) ? "fail" : "pass";

  return report;
}

export function syntheticDatasetValidationPassed(
  report: SyntheticDatasetValidationReport
): boolean {
  return report.errors.length === 0;
}

function readMetadata(
  metadataPath: string,
  errors: string[]
): SyntheticDatasetMetadata | null {
  if (!existsSync(metadataPath)) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(readFileSync(metadataPath, "utf8"));
    if (!isSyntheticDatasetMetadataShape(parsed)) {
      errors.push(`${SYNTHETIC_METADATA_FILE} has invalid shape`);
      return null;
    }

    return parsed;
  } catch (error) {
    errors.push(
      `${SYNTHETIC_METADATA_FILE} invalid JSON: ${errorMessage(error)}`
    );
    return null;
  }
}

function isSyntheticDatasetMetadataShape(
  value: unknown
): value is SyntheticDatasetMetadata {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const rowCounts = (value as { row_counts?: unknown }).row_counts;
  return (
    hasString(value, "dataset_label") &&
    hasString(value, "generator_version") &&
    hasString(value, "generated_at") &&
    hasString(value, "fixture_path") &&
    hasNumber(value, "schema_version") &&
    hasNumber(value, "random_seed") &&
    Array.isArray(
      (value as { required_case_ids?: unknown }).required_case_ids
    ) &&
    typeof rowCounts === "object" &&
    rowCounts !== null &&
    hasNumber(rowCounts, "songs") &&
    hasNumber(rowCounts, "song_aliases") &&
    hasNumber(rowCounts, "karaoke_entries") &&
    hasNumber(rowCounts, "karaoke_providers") &&
    hasNumber(rowCounts, "search_fixture_cases")
  );
}

function validateMetadata(
  metadata: SyntheticDatasetMetadata,
  datasetLabel: SyntheticDatasetLabel,
  errors: string[]
): void {
  const config = syntheticDatasetConfigFor(datasetLabel);

  if (metadata.schema_version !== 1) {
    errors.push(`${SYNTHETIC_METADATA_FILE} schema_version must be 1`);
  }
  if (metadata.dataset_label !== datasetLabel) {
    errors.push(
      `${SYNTHETIC_METADATA_FILE} dataset_label ${metadata.dataset_label} does not match ${datasetLabel}`
    );
  }
  if (metadata.generator_version !== SYNTHETIC_GENERATOR_VERSION) {
    errors.push(
      `${SYNTHETIC_METADATA_FILE} generator_version must be ${SYNTHETIC_GENERATOR_VERSION}`
    );
  }
  if (metadata.random_seed !== config.randomSeed) {
    errors.push(
      `${SYNTHETIC_METADATA_FILE} random_seed must be ${config.randomSeed}`
    );
  }
  if (metadata.generated_at !== config.deterministicGeneratedAt) {
    errors.push(
      `${SYNTHETIC_METADATA_FILE} generated_at must be ${config.deterministicGeneratedAt}`
    );
  }
  if (metadata.fixture_path !== SYNTHETIC_SEARCH_FIXTURE_FILE) {
    errors.push(
      `${SYNTHETIC_METADATA_FILE} fixture_path must be ${SYNTHETIC_SEARCH_FIXTURE_FILE}`
    );
  }
  if (
    !sameStringArray(metadata.required_case_ids, REQUIRED_SYNTHETIC_CASE_IDS)
  ) {
    errors.push(
      `${SYNTHETIC_METADATA_FILE} required_case_ids must be ${REQUIRED_SYNTHETIC_CASE_IDS.join(",")}`
    );
  }
}

function readSeedFiles(
  seedDir: string,
  errors: string[]
): Record<SeedFileName, CsvRecord[]> {
  return {
    "songs.csv": readTypedCsv(seedDir, "songs.csv", errors),
    "song_aliases.csv": readTypedCsv(seedDir, "song_aliases.csv", errors),
    "karaoke_entries.csv": readTypedCsv(seedDir, "karaoke_entries.csv", errors),
    "karaoke_providers.csv": readTypedCsv(
      seedDir,
      "karaoke_providers.csv",
      errors
    )
  };
}

function readTypedCsv(
  seedDir: string,
  file: SeedFileName,
  errors: string[]
): CsvRecord[] {
  const filePath = path.join(seedDir, file);
  if (!existsSync(filePath)) {
    return [];
  }

  try {
    const rows = readCsvRows(filePath);
    const header = rows[0] ?? [];
    const expectedHeader = SEED_FILE_HEADERS[file];

    if (!sameStringArray(header, expectedHeader)) {
      errors.push(`${file} header must be ${expectedHeader.join(",")}`);
      return [];
    }

    return recordsFromCsvRows(expectedHeader, rows);
  } catch (error) {
    errors.push(`${file} invalid CSV: ${errorMessage(error)}`);
    return [];
  }
}

function readFixtureRows(fixturePath: string, errors: string[]): CsvRecord[] {
  if (!existsSync(fixturePath)) {
    return [];
  }

  try {
    const rows = readCsvRows(fixturePath);
    const header = rows[0] ?? [];

    if (!sameStringArray(header, SEARCH_FIXTURE_HEADERS)) {
      errors.push(
        `${SYNTHETIC_SEARCH_FIXTURE_FILE} header must be ${SEARCH_FIXTURE_HEADERS.join(",")}`
      );
      return [];
    }

    return recordsFromCsvRows(SEARCH_FIXTURE_HEADERS, rows);
  } catch (error) {
    errors.push(
      `${SYNTHETIC_SEARCH_FIXTURE_FILE} invalid CSV: ${errorMessage(error)}`
    );
    return [];
  }
}

function validateFileRowCounts(
  counts: SyntheticDatasetRowCounts,
  datasetLabel: SyntheticDatasetLabel,
  errors: string[]
): void {
  const config = syntheticDatasetConfigFor(datasetLabel);
  const expectedEntries = expectedSyntheticKaraokeEntryCount(config);
  const expectedAliases = expectedSyntheticAliasCount(config);
  const entryRange =
    datasetLabel === "synthetic-1k-songs-10k-aliases"
      ? { min: 2_000, max: 5_000 }
      : { min: 20_000, max: 50_000 };
  const providerRange =
    datasetLabel === "synthetic-1k-songs-10k-aliases"
      ? { min: 4, max: 10 }
      : { min: 4, max: 20 };

  expectCount(counts.songs, config.songCount, "songs", errors);
  expectCount(counts.song_aliases, expectedAliases, "song_aliases", errors);
  expectCount(
    counts.karaoke_entries,
    expectedEntries,
    "karaoke_entries",
    errors
  );
  expectRange(
    counts.karaoke_entries,
    entryRange.min,
    entryRange.max,
    "karaoke_entries",
    errors
  );
  expectRange(
    counts.karaoke_providers,
    providerRange.min,
    providerRange.max,
    "karaoke_providers",
    errors
  );
  expectCount(
    counts.search_fixture_cases,
    REQUIRED_SYNTHETIC_CASE_IDS.length,
    "search_fixture_cases",
    errors
  );
}

function validateMetadataRowCounts(
  metadata: SyntheticDatasetMetadata,
  counts: SyntheticDatasetRowCounts,
  errors: string[]
): void {
  for (const key of Object.keys(
    counts
  ) as (keyof SyntheticDatasetRowCounts)[]) {
    if (metadata.row_counts[key] !== counts[key]) {
      errors.push(
        `${SYNTHETIC_METADATA_FILE} row_counts.${key} ${metadata.row_counts[key]} does not match file count ${counts[key]}`
      );
    }
  }
}

function validateFixtureRows(
  records: CsvRecord[],
  datasetLabel: SyntheticDatasetLabel,
  errors: string[]
): Set<string> {
  const caseIds = new Set<string>();
  const config = syntheticDatasetConfigFor(datasetLabel);
  const validProviderId = `${config.idPrefix}_provider_01`;

  for (const record of records) {
    const caseId = record.values.case_id;
    caseIds.add(caseId);

    if (record.values.dataset_label !== datasetLabel) {
      errors.push(
        `${SYNTHETIC_SEARCH_FIXTURE_FILE} row ${record.rowNumber}: dataset_label ${record.values.dataset_label} does not match ${datasetLabel}`
      );
    }

    if (
      caseId === "valid-provider-filter" &&
      record.values.provider_id !== validProviderId
    ) {
      errors.push(
        `${SYNTHETIC_SEARCH_FIXTURE_FILE} row ${record.rowNumber}: valid-provider-filter provider_id must be ${validProviderId}`
      );
    }

    if (
      caseId === "invalid-provider-filter" &&
      record.values.provider_id !== "synthetic_missing_provider"
    ) {
      errors.push(
        `${SYNTHETIC_SEARCH_FIXTURE_FILE} row ${record.rowNumber}: invalid-provider-filter provider_id must be synthetic_missing_provider`
      );
    }
  }

  for (const requiredCaseId of REQUIRED_SYNTHETIC_CASE_IDS) {
    if (!caseIds.has(requiredCaseId)) {
      errors.push(
        `${SYNTHETIC_SEARCH_FIXTURE_FILE} missing required case_id ${requiredCaseId}`
      );
    }
  }

  return caseIds;
}

async function readDbRowCounts(
  db: SyntheticDatasetValidationDbClient,
  datasetLabel: SyntheticDatasetLabel
): Promise<SyntheticDatasetRowCounts> {
  const where = { verificationNote: datasetLabel };
  const [songs, songAliases, karaokeEntries, karaokeProviders] =
    await Promise.all([
      db.song.count({ where }),
      db.songAlias.count({ where }),
      db.karaokeEntry.count({ where }),
      db.karaokeProvider.count({ where })
    ]);

  return {
    songs,
    song_aliases: songAliases,
    karaoke_entries: karaokeEntries,
    karaoke_providers: karaokeProviders,
    search_fixture_cases: 0
  };
}

function validateDbRowCounts(
  counts: SyntheticDatasetRowCounts,
  datasetLabel: SyntheticDatasetLabel,
  errors: string[]
): boolean {
  const dbErrors: string[] = [];
  validateFileRowCounts(
    { ...counts, search_fixture_cases: REQUIRED_SYNTHETIC_CASE_IDS.length },
    datasetLabel,
    dbErrors
  );
  errors.push(...dbErrors.map((error) => `db ${error}`));
  return dbErrors.length === 0;
}

function expectCount(
  actual: number,
  expected: number,
  label: string,
  errors: string[]
): void {
  if (actual !== expected) {
    errors.push(`${label} count ${actual} does not match expected ${expected}`);
  }
}

function expectRange(
  actual: number,
  min: number,
  max: number,
  label: string,
  errors: string[]
): void {
  if (actual < min || actual > max) {
    errors.push(`${label} count ${actual} must be within ${min}-${max}`);
  }
}

function hasMetadataErrors(errors: string[]): boolean {
  return errors.some((error) => error.includes(SYNTHETIC_METADATA_FILE));
}

function hasFixtureErrors(errors: string[]): boolean {
  return errors.some((error) => error.includes(SYNTHETIC_SEARCH_FIXTURE_FILE));
}

function sameStringArray(
  actual: readonly string[],
  expected: readonly string[]
): boolean {
  return (
    actual.length === expected.length &&
    expected.every((value, index) => actual[index] === value)
  );
}

function hasString(value: object, key: string): boolean {
  return (
    Object.hasOwn(value, key) &&
    typeof (value as Record<string, unknown>)[key] === "string"
  );
}

function hasNumber(value: object, key: string): boolean {
  return (
    Object.hasOwn(value, key) &&
    typeof (value as Record<string, unknown>)[key] === "number"
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
