import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { parseCsv, recordsFromCsvRows, type CsvRecord } from "./csv";
import {
  formatSeedValidationIssue,
  SEED_FILE_HEADERS,
  validateSeedDirectory,
  type SeedFileName,
  type SeedValidationIssue,
  type SeedValidationResult
} from "./validate";

export type SeedImportMode = "dry-run" | "import";
export type SeedImportAction = "create" | "update" | "skip";

export type ProviderImportData = {
  id: string;
  name: string;
  country: string;
  isActive: boolean;
  displayOrder: number;
  isDefault: boolean;
  sourceUrl: string | null;
  sourceName: string | null;
  verifiedBy: string;
  verificationNote: string | null;
};

export type SongImportData = {
  id: string;
  originalLanguage: string;
  canonicalTitle: string;
  displayTitle: string;
  canonicalArtist: string;
  releaseYear: number | null;
  tieIn: string | null;
  sourceUrl: string | null;
  sourceName: string | null;
  verifiedBy: string;
  verificationNote: string | null;
};

export type AliasImportData = {
  id: string;
  songId: string;
  alias: string;
  language: string;
  aliasType: string;
  normalizedAlias: string;
  chosungAlias: string | null;
  sourceUrl: string | null;
  sourceName: string | null;
  verifiedBy: string;
  verificationNote: string | null;
};

export type EntryImportData = {
  id: string;
  songId: string;
  providerId: string;
  karaokeNumber: string;
  versionInfo: string;
  availabilityStatus: string;
  lastVerifiedAt: Date | null;
  sourceUrl: string | null;
  sourceName: string;
  verifiedBy: string | null;
  verificationNote: string | null;
};

export type SeedImportDataByFile = {
  "karaoke_providers.csv": ProviderImportData;
  "songs.csv": SongImportData;
  "song_aliases.csv": AliasImportData;
  "karaoke_entries.csv": EntryImportData;
};

export type SeedImportRowPlan<File extends SeedFileName = SeedFileName> = {
  file: File;
  row: number;
  id: string;
  action: SeedImportAction;
};

export type SeedImportFileReport = {
  file: SeedFileName;
  create: number;
  update: number;
  skip: number;
  warning: number;
  error: number;
};

export type SeedImportPlan = {
  files: SeedImportFileReport[];
  rows: SeedImportRowPlan[];
  warnings: SeedValidationIssue[];
  errors: SeedValidationIssue[];
};

export type SeedImportResult = SeedImportPlan & {
  mode: SeedImportMode;
  applied: boolean;
};

export type SeedImportOptions = {
  seedDir?: string;
  dryRun?: boolean;
};

type SeedImportTable<File extends SeedFileName = SeedFileName> = {
  file: File;
  records: CsvRecord[];
  data: SeedImportDataByFile[File][];
};

type FindManyArgs = {
  where: { id: { in: string[] } };
};

type UpsertArgs<TData> = {
  where: { id: string };
  create: TData;
  update: Omit<TData, "id">;
};

type SeedModelDelegate<TData extends { id: string }> = {
  findMany(args: FindManyArgs): Promise<TData[]>;
  upsert(args: UpsertArgs<TData>): Promise<unknown>;
};

export type SeedImportDbClient = {
  karaokeProvider: SeedModelDelegate<ProviderImportData>;
  song: SeedModelDelegate<SongImportData>;
  songAlias: SeedModelDelegate<AliasImportData>;
  karaokeEntry: SeedModelDelegate<EntryImportData>;
  $transaction<T>(
    run: (tx: SeedImportTransactionClient) => Promise<T>
  ): Promise<T>;
};

export type SeedImportTransactionClient = Omit<
  SeedImportDbClient,
  "$transaction"
>;

const DEFAULT_SEED_DIR = "seed";

export const SEED_IMPORT_ORDER = [
  "karaoke_providers.csv",
  "songs.csv",
  "song_aliases.csv",
  "karaoke_entries.csv"
] as const satisfies readonly SeedFileName[];

export async function importSeedDirectory(
  db: SeedImportDbClient,
  options: SeedImportOptions = {}
): Promise<SeedImportResult> {
  const seedDir = options.seedDir ?? DEFAULT_SEED_DIR;
  const mode: SeedImportMode = options.dryRun === true ? "dry-run" : "import";
  const validation = validateSeedDirectory(seedDir);

  if (validation.errors.length > 0) {
    return validationFailureResult(mode, validation);
  }

  const tables = readSeedImportTables(seedDir);
  const plan = await buildSeedImportPlan(db, tables, validation);

  if (mode === "dry-run") {
    return { ...plan, mode, applied: false };
  }

  const rowPlansByFile = new Map(
    SEED_IMPORT_ORDER.map((file) => [
      file,
      plan.rows.filter((row) => row.file === file)
    ])
  );

  await db.$transaction(async (tx) => {
    for (const table of tables) {
      await upsertTable(tx, table, rowPlansByFile.get(table.file) ?? []);
    }
  });

  return { ...plan, mode, applied: true };
}

export async function buildSeedImportPlan(
  db: SeedImportDbClient,
  tables: readonly SeedImportTable[],
  validation: SeedValidationResult = { errors: [], warnings: [] }
): Promise<SeedImportPlan> {
  const rows: SeedImportRowPlan[] = [];
  const files: SeedImportFileReport[] = [];

  for (const table of tables) {
    const existingRows = await modelFor(db, table.file).findMany({
      where: { id: { in: table.data.map((row) => row.id) } }
    });
    const existingById = new Map(existingRows.map((row) => [row.id, row]));
    const fileRows: SeedImportRowPlan[] = table.data.map((row, index) => {
      const existing = existingById.get(row.id);
      const action: SeedImportAction =
        existing === undefined
          ? "create"
          : sameImportData(existing, row)
            ? "skip"
            : "update";

      return {
        file: table.file,
        row: table.records[index]?.rowNumber ?? index + 2,
        id: row.id,
        action
      };
    });

    rows.push(...fileRows);
    files.push({
      file: table.file,
      create: countAction(fileRows, "create"),
      update: countAction(fileRows, "update"),
      skip: countAction(fileRows, "skip"),
      warning: validation.warnings.filter((issue) => issue.file === table.file)
        .length,
      error: validation.errors.filter((issue) => issue.file === table.file)
        .length
    });
  }

  return {
    files,
    rows,
    warnings: validation.warnings,
    errors: validation.errors
  };
}

export function readSeedImportTables(seedDir: string): SeedImportTable[] {
  return SEED_IMPORT_ORDER.map((file) => readSeedImportTable(seedDir, file));
}

export function formatSeedImportResult(result: SeedImportResult): string[] {
  const lines = [
    `Seed import ${result.mode === "dry-run" ? "dry-run" : "import"} ${result.applied ? "applied" : "planned"}.`,
    ...result.warnings.map(
      (warning) => `warning: ${formatSeedValidationIssue(warning)}`
    ),
    ...result.errors.map(
      (error) => `error: ${formatSeedValidationIssue(error)}`
    ),
    "File summary:",
    ...result.files.map(
      (file) =>
        `${file.file}: create=${file.create} update=${file.update} skip=${file.skip} warning=${file.warning} error=${file.error}`
    )
  ];

  if (result.rows.length > 0) {
    lines.push(
      "Row plan:",
      ...result.rows.map(
        (row) => `${row.file} row ${row.row}: ${row.action} ${row.id}`
      )
    );
  }

  if (result.mode === "dry-run") {
    lines.push("Dry-run completed without changing the database.");
  }

  return lines;
}

function validationFailureResult(
  mode: SeedImportMode,
  validation: SeedValidationResult
): SeedImportResult {
  return {
    mode,
    applied: false,
    files: SEED_IMPORT_ORDER.map((file) => ({
      file,
      create: 0,
      update: 0,
      skip: 0,
      warning: validation.warnings.filter((issue) => issue.file === file)
        .length,
      error: validation.errors.filter((issue) => issue.file === file).length
    })),
    rows: [],
    warnings: validation.warnings,
    errors: validation.errors
  };
}

function readSeedImportTable<File extends SeedFileName>(
  seedDir: string,
  file: File
): SeedImportTable<File> {
  const filePath = path.join(seedDir, file);

  if (!existsSync(filePath)) {
    throw new Error(`${file} is required`);
  }

  const rows = parseCsv(readFileSync(filePath, "utf8").replace(/^\uFEFF/u, ""));
  const records = recordsFromCsvRows(SEED_FILE_HEADERS[file], rows);

  return {
    file,
    records,
    data: records.map((record) => parseImportRecord(file, record))
  };
}

function parseImportRecord<File extends SeedFileName>(
  file: File,
  record: CsvRecord
): SeedImportDataByFile[File] {
  if (file === "karaoke_providers.csv") {
    return parseProvider(record) as SeedImportDataByFile[File];
  }

  if (file === "songs.csv") {
    return parseSong(record) as SeedImportDataByFile[File];
  }

  if (file === "song_aliases.csv") {
    return parseAlias(record) as SeedImportDataByFile[File];
  }

  return parseEntry(record) as SeedImportDataByFile[File];
}

function parseProvider(record: CsvRecord): ProviderImportData {
  return {
    id: record.values.id,
    name: record.values.name,
    country: record.values.country,
    isActive: parseBoolean(record.values.is_active),
    displayOrder: parseInteger(record.values.display_order),
    isDefault: parseBoolean(record.values.is_default),
    sourceUrl: nullableString(record.values.source_url),
    sourceName: nullableString(record.values.source_name),
    verifiedBy: record.values.verified_by,
    verificationNote: nullableString(record.values.verification_note)
  };
}

function parseSong(record: CsvRecord): SongImportData {
  return {
    id: record.values.id,
    originalLanguage: record.values.original_language,
    canonicalTitle: record.values.canonical_title,
    displayTitle: record.values.display_title,
    canonicalArtist: record.values.canonical_artist,
    releaseYear: nullableInteger(record.values.release_year),
    tieIn: nullableString(record.values.tie_in),
    sourceUrl: nullableString(record.values.source_url),
    sourceName: nullableString(record.values.source_name),
    verifiedBy: record.values.verified_by,
    verificationNote: nullableString(record.values.verification_note)
  };
}

function parseAlias(record: CsvRecord): AliasImportData {
  return {
    id: record.values.id,
    songId: record.values.song_id,
    alias: record.values.alias,
    language: record.values.language,
    aliasType: record.values.alias_type,
    normalizedAlias: record.values.normalized_alias,
    chosungAlias: nullableString(record.values.chosung_alias),
    sourceUrl: nullableString(record.values.source_url),
    sourceName: nullableString(record.values.source_name),
    verifiedBy: record.values.verified_by,
    verificationNote: nullableString(record.values.verification_note)
  };
}

function parseEntry(record: CsvRecord): EntryImportData {
  return {
    id: record.values.id,
    songId: record.values.song_id,
    providerId: record.values.provider_id,
    karaokeNumber: record.values.karaoke_number,
    versionInfo: record.values.version_info,
    availabilityStatus: record.values.availability_status,
    lastVerifiedAt: nullableDateOnly(record.values.last_verified_at),
    sourceUrl: nullableString(record.values.source_url),
    sourceName: record.values.source_name,
    verifiedBy: nullableString(record.values.verified_by),
    verificationNote: nullableString(record.values.verification_note)
  };
}

async function upsertTable(
  tx: SeedImportTransactionClient,
  table: SeedImportTable,
  rowPlans: readonly SeedImportRowPlan[]
): Promise<void> {
  const model = modelFor(tx, table.file);
  const writableIds = new Set(
    rowPlans
      .filter((row) => row.action === "create" || row.action === "update")
      .map((row) => row.id)
  );

  for (const row of table.data) {
    if (!writableIds.has(row.id)) {
      continue;
    }

    await model.upsert({
      where: { id: row.id },
      create: row,
      update: withoutId(row)
    });
  }
}

function modelFor(
  db: SeedImportTransactionClient,
  file: SeedFileName
): SeedModelDelegate<{ id: string }> {
  if (file === "karaoke_providers.csv") {
    return db.karaokeProvider;
  }

  if (file === "songs.csv") {
    return db.song;
  }

  if (file === "song_aliases.csv") {
    return db.songAlias;
  }

  return db.karaokeEntry;
}

function withoutId<TData extends { id: string }>(
  row: TData
): Omit<TData, "id"> {
  const rest: Partial<TData> = { ...row };
  delete rest.id;
  return rest as Omit<TData, "id">;
}

function sameImportData(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>
): boolean {
  const comparableKeys = Object.keys(incoming).filter(isComparableKey);

  return (
    JSON.stringify(
      sortObjectKeys(normalizeComparable(existing, comparableKeys))
    ) ===
    JSON.stringify(
      sortObjectKeys(normalizeComparable(incoming, comparableKeys))
    )
  );
}

function normalizeComparable(
  row: Record<string, unknown>,
  keys: readonly string[]
): Record<string, unknown> {
  return Object.fromEntries(keys.map((key) => [key, normalizeValue(row[key])]));
}

function isComparableKey(key: string): boolean {
  return key !== "createdAt" && key !== "updatedAt";
}

function normalizeValue(value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  return value;
}

function sortObjectKeys(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(row).sort(([left], [right]) => left.localeCompare(right))
  );
}

function countAction(
  rows: readonly SeedImportRowPlan[],
  action: SeedImportAction
): number {
  return rows.filter((row) => row.action === action).length;
}

function nullableString(value: string): string | null {
  return value.trim() === "" ? null : value;
}

function nullableInteger(value: string): number | null {
  return value.trim() === "" ? null : parseInteger(value);
}

function parseInteger(value: string): number {
  const trimmed = value.trim();

  if (!/^-?\d+$/u.test(trimmed)) {
    throw new Error(`expected integer but received ${value}`);
  }

  const parsed = Number(trimmed);

  if (!Number.isInteger(parsed)) {
    throw new Error(`expected integer but received ${value}`);
  }

  return parsed;
}

function parseBoolean(value: string): boolean {
  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  throw new Error(`expected boolean but received ${value}`);
}

function nullableDateOnly(value: string): Date | null {
  const trimmed = value.trim();

  if (trimmed === "") {
    return null;
  }

  if (!/^\d{4}-\d{2}-\d{2}$/u.test(trimmed)) {
    throw new Error(`expected YYYY-MM-DD date but received ${value}`);
  }

  const date = new Date(`${trimmed}T00:00:00.000Z`);

  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== trimmed
  ) {
    throw new Error(`expected valid YYYY-MM-DD date but received ${value}`);
  }

  return date;
}
