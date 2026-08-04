import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { buildAliasSearchFields } from "../search/normalize";
import { normalizeSongIdentity } from "../song-identity/normalize";
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
  normalizedCanonicalTitle: string | null;
  normalizedCanonicalArtist: string | null;
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
  writeBatchSize?: number;
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

type CreateManyArgs<TData> = {
  data: TData[];
};

type SeedModelDelegate<TData extends { id: string }> = {
  findMany(args: FindManyArgs): Promise<TData[]>;
  createMany?(args: CreateManyArgs<TData>): Promise<unknown>;
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
export const SEED_IMPORT_QUERY_BATCH_SIZE = 1_000;
export const SEED_IMPORT_MAX_WRITE_BATCH_SIZE = 1_000;

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
  const writeBatchSize = normalizeWriteBatchSize(options.writeBatchSize);
  const validation = validateSeedDirectory(seedDir);

  if (validation.errors.length > 0) {
    return validationFailureResult(mode, validation);
  }

  const tables = readSeedImportTables(seedDir);
  const systemAliasCandidates = buildSystemAliasCandidates(tables);
  await assertSystemAliasCandidateIdsAvailable(
    db,
    tables,
    systemAliasCandidates
  );
  const planningTables = includeSystemAliasCandidates(
    tables,
    systemAliasCandidates
  );
  const plan = await buildSeedImportPlan(db, planningTables, validation);

  if (mode === "dry-run") {
    return { ...plan, mode, applied: false };
  }

  const rowPlansByFile = new Map(
    SEED_IMPORT_ORDER.map((file) => [
      file,
      plan.rows.filter((row) => row.file === file)
    ])
  );

  if (writeBatchSize === undefined) {
    await db.$transaction(async (tx) => {
      for (const table of tables) {
        await upsertTable(tx, table, rowPlansByFile.get(table.file) ?? []);
      }
      await ensureSystemAliases(tx, systemAliasCandidates);
    });
  } else {
    for (const table of tables) {
      await upsertTableInBatches(
        db,
        table,
        rowPlansByFile.get(table.file) ?? [],
        writeBatchSize
      );
    }
    await upsertRowsInBatches(
      db,
      "song_aliases.csv",
      systemAliasCandidates,
      rowPlansByFile.get("song_aliases.csv") ?? [],
      writeBatchSize
    );
  }

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
    const model = modelFor(db, table.file);
    const existingRows: { id: string }[] = [];
    for (const batch of batches(table.data, SEED_IMPORT_QUERY_BATCH_SIZE)) {
      const found = await model.findMany({
        where: { id: { in: batch.map((row) => row.id) } }
      });
      for (const row of found) {
        existingRows.push(row);
      }
    }
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

    for (const row of fileRows) {
      rows.push(row);
    }
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

export function formatSeedImportResult(
  result: SeedImportResult,
  options: { includeRows?: boolean } = {}
): string[] {
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
    if (options.includeRows === false) {
      lines.push(`Row plan omitted (${result.rows.length} rows).`);
    } else {
      lines.push("Row plan:");
      for (const row of result.rows) {
        lines.push(`${row.file} row ${row.row}: ${row.action} ${row.id}`);
      }
    }
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
  const identity = normalizeSongIdentity({
    canonical_title: record.values.canonical_title,
    canonical_artist: record.values.canonical_artist
  });
  return {
    id: record.values.id,
    originalLanguage: record.values.original_language,
    canonicalTitle: record.values.canonical_title,
    displayTitle: record.values.display_title,
    canonicalArtist: record.values.canonical_artist,
    normalizedCanonicalTitle: identity.normalizedCanonicalTitle,
    normalizedCanonicalArtist: identity.normalizedCanonicalArtist,
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
  await upsertRows(modelFor(tx, table.file), table.data, rowPlans);
}

async function upsertTableInBatches(
  db: SeedImportDbClient,
  table: SeedImportTable,
  rowPlans: readonly SeedImportRowPlan[],
  batchSize: number
): Promise<void> {
  await upsertRowsInBatches(db, table.file, table.data, rowPlans, batchSize);
}

async function upsertRowsInBatches<TData extends { id: string }>(
  db: SeedImportDbClient,
  file: SeedFileName,
  rows: readonly TData[],
  rowPlans: readonly SeedImportRowPlan[],
  batchSize: number
): Promise<void> {
  if (rows.length === 0) {
    return;
  }
  const plannedRows = writableRows(rows, rowPlans);
  for (const batch of batches(plannedRows, batchSize)) {
    await db.$transaction(async (tx) => {
      await upsertPlannedRows(modelFor(tx, file), batch, true);
    });
  }
}

async function upsertRows<TData extends { id: string }>(
  model: SeedModelDelegate<TData>,
  rows: readonly TData[],
  rowPlans: readonly SeedImportRowPlan[]
): Promise<void> {
  if (rows.length === 0) {
    return;
  }
  await upsertPlannedRows(model, writableRows(rows, rowPlans), false);
}

async function ensureSystemAliases(
  tx: SeedImportTransactionClient,
  candidates: readonly AliasImportData[]
): Promise<void> {
  for (const row of candidates) {
    const [stored] = await tx.songAlias.findMany({
      where: { id: { in: [row.id] } }
    });
    if (
      stored !== undefined &&
      sameImportData(
        stored as unknown as Record<string, unknown>,
        row as unknown as Record<string, unknown>
      )
    ) {
      continue;
    }
    await upsertRow(tx.songAlias, row);
  }
}

type PlannedWritableRow<TData extends { id: string }> = {
  data: TData;
  action: Extract<SeedImportAction, "create" | "update">;
};

function writableRows<TData extends { id: string }>(
  rows: readonly TData[],
  rowPlans: readonly SeedImportRowPlan[]
): PlannedWritableRow<TData>[] {
  const actionById = new Map(
    rowPlans.map((row) => [row.id, row.action] as const)
  );
  const writable: PlannedWritableRow<TData>[] = [];
  for (const data of rows) {
    const action = actionById.get(data.id);
    if (action === "create" || action === "update") {
      writable.push({ data, action });
    }
  }
  return writable;
}

async function upsertPlannedRows<TData extends { id: string }>(
  model: SeedModelDelegate<TData>,
  rows: readonly PlannedWritableRow<TData>[],
  bulkCreate: boolean
): Promise<void> {
  if (bulkCreate && model.createMany !== undefined) {
    const createRows: TData[] = [];
    for (const row of rows) {
      if (row.action === "create") {
        createRows.push(row.data);
      }
    }
    if (createRows.length > 0) {
      await model.createMany({ data: createRows });
    }
    for (const row of rows) {
      if (row.action === "update") {
        await upsertRow(model, row.data);
      }
    }
    return;
  }

  for (const row of rows) {
    await upsertRow(model, row.data);
  }
}

async function upsertRow<TData extends { id: string }>(
  model: SeedModelDelegate<TData>,
  row: TData
): Promise<void> {
  await model.upsert({
    where: { id: row.id },
    create: row,
    update: withoutId(row)
  });
}

function includeSystemAliasCandidates(
  tables: readonly SeedImportTable[],
  candidates: readonly AliasImportData[]
): SeedImportTable[] {
  return tables.map((table) =>
    table.file === "song_aliases.csv"
      ? ({
          ...table,
          data: [...(table.data as AliasImportData[]), ...candidates]
        } as SeedImportTable)
      : table
  );
}

function buildSystemAliasCandidates(
  tables: readonly SeedImportTable[]
): AliasImportData[] {
  const songTable = tables.find(
    (table): table is SeedImportTable<"songs.csv"> => table.file === "songs.csv"
  );
  const aliasTable = tables.find(
    (table): table is SeedImportTable<"song_aliases.csv"> =>
      table.file === "song_aliases.csv"
  );
  if (songTable === undefined || aliasTable === undefined) {
    throw new Error("Song and alias seed tables are required.");
  }
  const existingAliasKeys = new Set(
    aliasTable.data.map((alias) =>
      systemAliasKey(alias.songId, alias.aliasType, alias.normalizedAlias)
    )
  );
  const candidates: AliasImportData[] = [];
  for (const song of songTable.data) {
    const systemValues = [
      {
        aliasType: "canonical_title",
        alias: song.canonicalTitle
      },
      {
        aliasType: "display_title",
        alias: song.displayTitle
      },
      {
        aliasType: "artist",
        alias: song.canonicalArtist
      }
    ] as const;
    for (const system of systemValues) {
      const search = buildAliasSearchFields(system.alias);
      const key = systemAliasKey(
        song.id,
        system.aliasType,
        search.normalizedAlias
      );
      if (existingAliasKeys.has(key)) {
        continue;
      }
      const row: AliasImportData = {
        id: `alias_system_${song.id}_${system.aliasType}`,
        songId: song.id,
        alias: system.alias,
        language: song.originalLanguage,
        aliasType: system.aliasType,
        normalizedAlias: search.normalizedAlias,
        chosungAlias: search.chosungAlias || null,
        sourceUrl: song.sourceUrl,
        sourceName: song.sourceName,
        verifiedBy: song.verifiedBy,
        verificationNote: song.verificationNote
      };
      candidates.push(row);
      existingAliasKeys.add(key);
    }
  }
  return candidates;
}

async function assertSystemAliasCandidateIdsAvailable(
  db: SeedImportDbClient,
  tables: readonly SeedImportTable[],
  candidates: readonly AliasImportData[]
): Promise<void> {
  const aliasTable = tables.find(
    (table): table is SeedImportTable<"song_aliases.csv"> =>
      table.file === "song_aliases.csv"
  );
  if (aliasTable === undefined) {
    throw new Error("Alias seed table is required.");
  }

  const inputAliasesById = new Map(
    aliasTable.data.map((alias) => [alias.id, alias])
  );
  for (const candidate of candidates) {
    const inputAlias = inputAliasesById.get(candidate.id);
    if (
      inputAlias !== undefined &&
      aliasIdentityKey(inputAlias) !== aliasIdentityKey(candidate)
    ) {
      throw new Error(
        `System alias ID collision in seed input: ${candidate.id}`
      );
    }
  }

  const storedAliasesById = new Map<string, AliasImportData>();
  for (const batch of batches(candidates, SEED_IMPORT_QUERY_BATCH_SIZE)) {
    const storedAliases = await db.songAlias.findMany({
      where: { id: { in: batch.map((candidate) => candidate.id) } }
    });
    for (const alias of storedAliases) {
      storedAliasesById.set(alias.id, alias);
    }
  }
  for (const candidate of candidates) {
    const storedAlias = storedAliasesById.get(candidate.id);
    if (
      storedAlias !== undefined &&
      aliasIdentityKey(storedAlias) !== aliasIdentityKey(candidate)
    ) {
      throw new Error(`System alias ID collision in database: ${candidate.id}`);
    }
  }
}

function aliasIdentityKey(alias: AliasImportData): string {
  return systemAliasKey(alias.songId, alias.aliasType, alias.normalizedAlias);
}

function systemAliasKey(
  songId: string,
  aliasType: string,
  normalizedAlias: string
): string {
  return JSON.stringify([songId, aliasType, normalizedAlias]);
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
  let count = 0;
  for (const row of rows) {
    if (row.action === action) {
      count += 1;
    }
  }
  return count;
}

function normalizeWriteBatchSize(
  value: number | undefined
): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (
    !Number.isInteger(value) ||
    value <= 0 ||
    value > SEED_IMPORT_MAX_WRITE_BATCH_SIZE
  ) {
    throw new Error(
      `writeBatchSize must be an integer between 1 and ${SEED_IMPORT_MAX_WRITE_BATCH_SIZE}`
    );
  }

  return value;
}

function* batches<T>(
  rows: readonly T[],
  batchSize: number
): Generator<T[], void, undefined> {
  for (let index = 0; index < rows.length; index += batchSize) {
    yield rows.slice(index, index + batchSize);
  }
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
