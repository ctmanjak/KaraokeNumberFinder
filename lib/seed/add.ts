import { existsSync } from "node:fs";
import path from "node:path";

import { buildAliasSearchFields } from "../search/normalize";
import {
  readCsvRows,
  recordsFromCsvRows,
  writeCsvRows,
  type CsvRecord
} from "./csv";
import {
  ALIAS_TYPES,
  AVAILABILITY_STATUSES,
  formatSeedValidationIssue,
  SEED_FILE_HEADERS,
  validateSeedDirectory,
  type SeedFileName,
  type SeedValidationResult
} from "./validate";

export type AddSongInput = {
  original_language: string;
  canonical_title: string;
  display_title: string;
  canonical_artist: string;
  release_year?: string;
  tie_in?: string;
  source_url?: string;
  source_name?: string;
  verified_by: string;
  verification_note?: string;
};

export type AddAliasInput = {
  song_id: string;
  alias: string;
  language: string;
  alias_type: string;
  source_url?: string;
  source_name?: string;
  verified_by: string;
  verification_note?: string;
};

export type AddEntryInput = {
  song_id: string;
  provider_id: string;
  karaoke_number?: string;
  version_info?: string;
  availability_status: string;
  last_verified_at?: string;
  source_url?: string;
  source_name: string;
  verified_by?: string;
  verification_note?: string;
};

export type SeedAddOptions = {
  seedDir?: string;
  validateAfter?: boolean;
};

export type SeedAddResult = {
  file: SeedFileName;
  rowNumber: number;
  id: string;
  validation?: SeedValidationResult;
};

type SeedTable = {
  file: SeedFileName;
  filePath: string;
  header: readonly string[];
  rows: string[][];
  records: CsvRecord[];
};

const DEFAULT_SEED_DIR = "seed";

export function addSongRow(
  input: AddSongInput,
  options: SeedAddOptions = {}
): SeedAddResult {
  const seedDir = options.seedDir ?? DEFAULT_SEED_DIR;
  const songs = readSeedTable(seedDir, "songs.csv");
  const id = generateSequenceId(
    `song_${toIdPart(input.original_language)}_`,
    allIds(songs.records),
    4
  );

  requireValue("original_language", input.original_language);
  requireValue("canonical_title", input.canonical_title);
  requireValue("display_title", input.display_title);
  requireValue("canonical_artist", input.canonical_artist);
  requireValue("verified_by", input.verified_by);

  const values = {
    id,
    original_language: input.original_language,
    canonical_title: input.canonical_title,
    display_title: input.display_title,
    canonical_artist: input.canonical_artist,
    release_year: input.release_year ?? "",
    tie_in: input.tie_in ?? "",
    source_url: input.source_url ?? "",
    source_name: input.source_name ?? "",
    verified_by: input.verified_by,
    verification_note: input.verification_note ?? ""
  };

  return appendAndValidate(songs, values, seedDir, options);
}

export function addAliasRow(
  input: AddAliasInput,
  options: SeedAddOptions = {}
): SeedAddResult {
  const seedDir = options.seedDir ?? DEFAULT_SEED_DIR;
  const songs = readSeedTable(seedDir, "songs.csv");
  const aliases = readSeedTable(seedDir, "song_aliases.csv");

  requireValue("song_id", input.song_id);
  requireValue("alias", input.alias);
  requireValue("language", input.language);
  requireValue("alias_type", input.alias_type);
  requireValue("verified_by", input.verified_by);

  if (!ALIAS_TYPES.has(input.alias_type)) {
    throw new Error(
      `alias_type must be one of ${Array.from(ALIAS_TYPES).join(", ")}`
    );
  }

  if (!hasId(songs.records, input.song_id)) {
    throw new Error(`song_id ${input.song_id} not found in songs.csv`);
  }

  const searchFields = buildAliasSearchFields(input.alias);
  const duplicate = aliases.records.find(
    (record) =>
      record.values.song_id === input.song_id &&
      record.values.alias_type === input.alias_type &&
      (record.values.normalized_alias ||
        buildAliasSearchFields(record.values.alias).normalizedAlias) ===
        searchFields.normalizedAlias
  );

  if (duplicate !== undefined) {
    throw new Error(
      `duplicate song_id + normalized_alias + alias_type already used at song_aliases.csv row ${duplicate.rowNumber}`
    );
  }

  const id = generateSequenceId(
    `alias_${toIdPart(input.song_id)}_${toIdPart(input.alias_type)}_`,
    allIds(aliases.records),
    4
  );

  const values = {
    id,
    song_id: input.song_id,
    alias: input.alias,
    language: input.language,
    alias_type: input.alias_type,
    normalized_alias: searchFields.normalizedAlias,
    chosung_alias: searchFields.chosungAlias,
    source_url: input.source_url ?? "",
    source_name: input.source_name ?? "",
    verified_by: input.verified_by,
    verification_note: input.verification_note ?? ""
  };

  return appendAndValidate(aliases, values, seedDir, options);
}

export function addEntryRow(
  input: AddEntryInput,
  options: SeedAddOptions = {}
): SeedAddResult {
  const seedDir = options.seedDir ?? DEFAULT_SEED_DIR;
  const songs = readSeedTable(seedDir, "songs.csv");
  const providers = readSeedTable(seedDir, "karaoke_providers.csv");
  const entries = readSeedTable(seedDir, "karaoke_entries.csv");

  requireValue("song_id", input.song_id);
  requireValue("provider_id", input.provider_id);
  requireValue("availability_status", input.availability_status);
  requireValue("source_name", input.source_name);

  if (!AVAILABILITY_STATUSES.has(input.availability_status)) {
    throw new Error(
      `availability_status must be one of ${Array.from(
        AVAILABILITY_STATUSES
      ).join(", ")}`
    );
  }

  if (!hasId(songs.records, input.song_id)) {
    throw new Error(`song_id ${input.song_id} not found in songs.csv`);
  }

  if (!hasId(providers.records, input.provider_id)) {
    throw new Error(
      `provider_id ${input.provider_id} not found in karaoke_providers.csv`
    );
  }

  validateEntryStatusInput(input);

  const versionInfo = input.version_info ?? "";
  const karaokeNumber = input.karaoke_number ?? "";
  const duplicate = entries.records.find(
    (record) =>
      record.values.song_id === input.song_id &&
      record.values.provider_id === input.provider_id &&
      record.values.version_info === versionInfo &&
      record.values.karaoke_number === karaokeNumber
  );

  if (duplicate !== undefined) {
    throw new Error(
      `duplicate song_id + provider_id + version_info + karaoke_number already used at karaoke_entries.csv row ${duplicate.rowNumber}`
    );
  }

  const id = generateEntryId(input, allIds(entries.records));
  const values = {
    id,
    song_id: input.song_id,
    provider_id: input.provider_id,
    karaoke_number: karaokeNumber,
    version_info: versionInfo,
    availability_status: input.availability_status,
    last_verified_at: input.last_verified_at ?? "",
    source_url: input.source_url ?? "",
    source_name: input.source_name,
    verified_by: input.verified_by ?? "",
    verification_note: input.verification_note ?? ""
  };

  return appendAndValidate(entries, values, seedDir, options);
}

export function formatSeedAddValidation(result: SeedAddResult): string[] {
  if (result.validation === undefined) {
    return [];
  }

  return [
    ...result.validation.warnings.map(
      (warning) => `warning: ${formatSeedValidationIssue(warning)}`
    ),
    ...result.validation.errors.map(
      (error) => `error: ${formatSeedValidationIssue(error)}`
    )
  ];
}

export function readProviderChoices(seedDir = DEFAULT_SEED_DIR): string[] {
  const providers = readSeedTable(seedDir, "karaoke_providers.csv");

  return providers.records.map(
    (provider) =>
      `${provider.values.id} (${provider.values.name}, active=${provider.values.is_active}, default=${provider.values.is_default})`
  );
}

function readSeedTable(seedDir: string, file: SeedFileName): SeedTable {
  const filePath = path.join(seedDir, file);

  if (!existsSync(filePath)) {
    throw new Error(`${file} is required`);
  }

  const rows = readCsvRows(filePath);
  const header = SEED_FILE_HEADERS[file];
  const actualHeader = rows[0] ?? [];

  if (!sameHeader(actualHeader, header)) {
    throw new Error(`${file} header must be ${header.join(",")}`);
  }

  for (const row of rows.slice(1)) {
    if (row.length === 1 && isBlank(row[0])) {
      continue;
    }

    if (row.length !== header.length) {
      throw new Error(`${file} contains a row with ${row.length} columns`);
    }
  }

  return {
    file,
    filePath,
    header,
    rows,
    records: recordsFromCsvRows(header, rows)
  };
}

function appendAndValidate(
  table: SeedTable,
  values: Record<string, string>,
  seedDir: string,
  options: SeedAddOptions
): SeedAddResult {
  const row = table.header.map((column) => values[column] ?? "");
  const rows =
    table.rows.length === 0 ? [Array.from(table.header)] : table.rows;
  const nextRows = [...rows, row];
  const rowNumber = nextRows.length;

  writeCsvRows(table.filePath, nextRows);

  const validation =
    options.validateAfter === false
      ? undefined
      : validateSeedDirectory(seedDir);

  if (validation !== undefined && validation.errors.length > 0) {
    writeCsvRows(table.filePath, table.rows);
  }

  return {
    file: table.file,
    rowNumber,
    id: values.id ?? "",
    validation
  };
}

function validateEntryStatusInput(input: AddEntryInput): void {
  const status = input.availability_status;
  const karaokeNumber = input.karaoke_number ?? "";
  const lastVerifiedAt = input.last_verified_at ?? "";
  const verifiedBy = input.verified_by ?? "";

  if (status === "available") {
    requireValue("karaoke_number", karaokeNumber);
    requireValue("last_verified_at", lastVerifiedAt);
    requireValue("verified_by", verifiedBy);
    return;
  }

  if (status === "not_available" || status === "temporarily_unavailable") {
    if (!isBlank(karaokeNumber)) {
      throw new Error(
        `karaoke_number must be empty when availability_status=${status}`
      );
    }

    requireValue("last_verified_at", lastVerifiedAt);
    requireValue("verified_by", verifiedBy);
    return;
  }

  if (status === "unknown" && !isBlank(karaokeNumber)) {
    throw new Error(
      "karaoke_number must be empty when availability_status=unknown"
    );
  }
}

function generateEntryId(input: AddEntryInput, ids: Set<string>): string {
  const base = [
    "entry",
    toIdPart(input.song_id),
    toIdPart(input.provider_id),
    toIdPart(input.version_info || "default")
  ].join("_");

  if (!ids.has(base)) {
    return base;
  }

  let sequence = 2;
  let candidate = `${base}_${sequence.toString().padStart(4, "0")}`;

  while (ids.has(candidate)) {
    sequence += 1;
    candidate = `${base}_${sequence.toString().padStart(4, "0")}`;
  }

  return candidate;
}

function generateSequenceId(
  prefix: string,
  ids: Set<string>,
  padding: number
): string {
  let maxSequence = 0;

  for (const id of ids) {
    if (!id.startsWith(prefix)) {
      continue;
    }

    const suffix = id.slice(prefix.length);

    if (/^\d+$/u.test(suffix)) {
      maxSequence = Math.max(maxSequence, Number(suffix));
    }
  }

  let sequence = maxSequence + 1;
  let candidate = `${prefix}${sequence.toString().padStart(padding, "0")}`;

  while (ids.has(candidate)) {
    sequence += 1;
    candidate = `${prefix}${sequence.toString().padStart(padding, "0")}`;
  }

  return candidate;
}

function allIds(records: readonly CsvRecord[]): Set<string> {
  return new Set(records.map((record) => record.values.id).filter(Boolean));
}

function hasId(records: readonly CsvRecord[], id: string): boolean {
  return records.some((record) => record.values.id === id);
}

function toIdPart(value: string): string {
  const normalized = value
    .trim()
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/gu, "_")
    .replace(/_+/gu, "_")
    .replace(/^_+|_+$/gu, "");

  return normalized === "" ? "item" : normalized;
}

function requireValue(field: string, value: string | undefined): void {
  if (isBlank(value)) {
    throw new Error(`${field} is required`);
  }
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

function isBlank(value: string | undefined): boolean {
  return value === undefined || value.trim() === "";
}
