import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { buildAliasSearchFields } from "../search/normalize";
import { parseCsv, type CsvRecord } from "./csv";

export type SeedValidationSeverity = "error" | "warning";

export type SeedValidationIssue = {
  severity: SeedValidationSeverity;
  file: SeedFileName;
  row?: number;
  message: string;
};

export type SeedValidationResult = {
  errors: SeedValidationIssue[];
  warnings: SeedValidationIssue[];
};

export type SeedFileName =
  | "karaoke_providers.csv"
  | "songs.csv"
  | "song_aliases.csv"
  | "karaoke_entries.csv";

const STALE_VERIFICATION_DAYS = 180;
const DAY_MS = 24 * 60 * 60 * 1000;

export const SEED_FILE_HEADERS = {
  "karaoke_providers.csv": [
    "id",
    "name",
    "country",
    "is_active",
    "display_order",
    "is_default",
    "source_url",
    "source_name",
    "verified_by",
    "verification_note"
  ],
  "songs.csv": [
    "id",
    "original_language",
    "canonical_title",
    "display_title",
    "canonical_artist",
    "release_year",
    "tie_in",
    "source_url",
    "source_name",
    "verified_by",
    "verification_note"
  ],
  "song_aliases.csv": [
    "id",
    "song_id",
    "alias",
    "language",
    "alias_type",
    "normalized_alias",
    "chosung_alias",
    "source_url",
    "source_name",
    "verified_by",
    "verification_note"
  ],
  "karaoke_entries.csv": [
    "id",
    "song_id",
    "provider_id",
    "karaoke_number",
    "version_info",
    "availability_status",
    "last_verified_at",
    "source_url",
    "source_name",
    "verified_by",
    "verification_note"
  ]
} as const satisfies Record<SeedFileName, readonly string[]>;

const SEED_FILE_NAMES = Object.keys(SEED_FILE_HEADERS) as SeedFileName[];

const REQUIRED_FIELDS: Record<SeedFileName, readonly string[]> = {
  "karaoke_providers.csv": [
    "id",
    "name",
    "country",
    "is_active",
    "display_order",
    "is_default",
    "verified_by"
  ],
  "songs.csv": [
    "id",
    "original_language",
    "canonical_title",
    "display_title",
    "canonical_artist",
    "verified_by"
  ],
  "song_aliases.csv": [
    "id",
    "song_id",
    "alias",
    "language",
    "alias_type",
    "verified_by"
  ],
  "karaoke_entries.csv": [
    "id",
    "song_id",
    "provider_id",
    "availability_status",
    "source_name"
  ]
};

export const ALIAS_TYPES = new Set([
  "canonical_title",
  "display_title",
  "artist",
  "romanized_title",
  "english_title",
  "translated_title",
  "content",
  "abbreviation",
  "common_name",
  "alternate_spelling"
]);

export const AVAILABILITY_STATUSES = new Set([
  "available",
  "not_available",
  "temporarily_unavailable",
  "unknown"
]);
const BOOLEAN_VALUES = new Set(["true", "false"]);

export function validateSeedDirectory(
  seedDir = "seed",
  options: { now?: Date } = {}
): SeedValidationResult {
  const now = options.now ?? new Date();
  const issues: SeedValidationIssue[] = [];
  const records = new Map<SeedFileName, CsvRecord[]>();

  for (const file of SEED_FILE_NAMES) {
    const filePath = path.join(seedDir, file);

    if (!existsSync(filePath)) {
      issues.push({ severity: "error", file, message: `${file} is required` });
      records.set(file, []);
      continue;
    }

    const parsed = readSeedCsv(file, filePath, issues);
    records.set(file, parsed);
  }

  validateRequiredFields(records, issues);
  validateProviderDefaults(records.get("karaoke_providers.csv") ?? [], issues);
  validateEnums(records, issues);
  validateForeignKeys(records, issues);
  validateAliasSearchFields(records.get("song_aliases.csv") ?? [], issues);
  validateEntryStatusRules(
    records.get("karaoke_entries.csv") ?? [],
    issues,
    now
  );
  validateDuplicates(records, issues);

  return {
    errors: issues.filter((issue) => issue.severity === "error"),
    warnings: issues.filter((issue) => issue.severity === "warning")
  };
}

export function formatSeedValidationIssue(issue: SeedValidationIssue): string {
  const row = issue.row === undefined ? "" : ` row ${issue.row}`;
  return `${issue.file}${row}: ${issue.message}`;
}

function readSeedCsv(
  file: SeedFileName,
  filePath: string,
  issues: SeedValidationIssue[]
): CsvRecord[] {
  const text = readFileSync(filePath, "utf8").replace(/^\uFEFF/u, "");
  const rows = parseCsv(text);
  const expectedHeader = SEED_FILE_HEADERS[file];
  const actualHeader = rows[0] ?? [];

  if (!sameHeader(actualHeader, expectedHeader)) {
    issues.push({
      severity: "error",
      file,
      row: rows.length === 0 ? undefined : 1,
      message: `header must be ${expectedHeader.join(",")}`
    });
    return [];
  }

  return rows.slice(1).flatMap((row, index) => {
    if (row.length === 1 && isBlank(row[0])) {
      return [];
    }

    const rowNumber = index + 2;

    if (row.length !== expectedHeader.length) {
      issues.push({
        severity: "error",
        file,
        row: rowNumber,
        message: `expected ${expectedHeader.length} columns but found ${row.length}`
      });
      return [];
    }

    return [
      {
        rowNumber,
        values: Object.fromEntries(
          expectedHeader.map((column, columnIndex) => [
            column,
            row[columnIndex]
          ])
        )
      }
    ];
  });
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

function validateRequiredFields(
  records: Map<SeedFileName, CsvRecord[]>,
  issues: SeedValidationIssue[]
): void {
  for (const [file, requiredFields] of Object.entries(REQUIRED_FIELDS) as [
    SeedFileName,
    readonly string[]
  ][]) {
    for (const record of records.get(file) ?? []) {
      for (const field of requiredFields) {
        if (isBlank(record.values[field])) {
          issues.push({
            severity: "error",
            file,
            row: record.rowNumber,
            message: `${field} is required`
          });
        }
      }
    }
  }
}

function validateProviderDefaults(
  providers: CsvRecord[],
  issues: SeedValidationIssue[]
): void {
  if (providers.length === 0) {
    return;
  }

  const activeDefaultCount = providers.filter(
    (provider) =>
      provider.values.is_active === "true" &&
      provider.values.is_default === "true"
  ).length;

  if (activeDefaultCount !== 1) {
    issues.push({
      severity: "error",
      file: "karaoke_providers.csv",
      message: "exactly one active provider must have is_default=true"
    });
  }
}

function validateEnums(
  records: Map<SeedFileName, CsvRecord[]>,
  issues: SeedValidationIssue[]
): void {
  for (const provider of records.get("karaoke_providers.csv") ?? []) {
    for (const field of ["is_active", "is_default"]) {
      const value = provider.values[field];

      if (!isBlank(value) && !BOOLEAN_VALUES.has(value)) {
        issues.push({
          severity: "error",
          file: "karaoke_providers.csv",
          row: provider.rowNumber,
          message: `${field} must be one of true, false`
        });
      }
    }
  }

  for (const alias of records.get("song_aliases.csv") ?? []) {
    if (
      !isBlank(alias.values.alias_type) &&
      !ALIAS_TYPES.has(alias.values.alias_type)
    ) {
      issues.push({
        severity: "error",
        file: "song_aliases.csv",
        row: alias.rowNumber,
        message: `alias_type must be one of ${Array.from(ALIAS_TYPES).join(", ")}`
      });
    }
  }

  for (const entry of records.get("karaoke_entries.csv") ?? []) {
    if (
      !isBlank(entry.values.availability_status) &&
      !AVAILABILITY_STATUSES.has(entry.values.availability_status)
    ) {
      issues.push({
        severity: "error",
        file: "karaoke_entries.csv",
        row: entry.rowNumber,
        message: `availability_status must be one of ${Array.from(
          AVAILABILITY_STATUSES
        ).join(", ")}`
      });
    }
  }
}

function validateForeignKeys(
  records: Map<SeedFileName, CsvRecord[]>,
  issues: SeedValidationIssue[]
): void {
  const songIds = new Set(
    (records.get("songs.csv") ?? [])
      .map((song) => song.values.id)
      .filter(Boolean)
  );
  const providerIds = new Set(
    (records.get("karaoke_providers.csv") ?? [])
      .map((provider) => provider.values.id)
      .filter(Boolean)
  );

  for (const alias of records.get("song_aliases.csv") ?? []) {
    const songId = alias.values.song_id;
    if (!isBlank(songId) && !songIds.has(songId)) {
      issues.push({
        severity: "error",
        file: "song_aliases.csv",
        row: alias.rowNumber,
        message: `song_id ${songId} not found in songs.csv`
      });
    }
  }

  for (const entry of records.get("karaoke_entries.csv") ?? []) {
    const songId = entry.values.song_id;
    const providerId = entry.values.provider_id;

    if (!isBlank(songId) && !songIds.has(songId)) {
      issues.push({
        severity: "error",
        file: "karaoke_entries.csv",
        row: entry.rowNumber,
        message: `song_id ${songId} not found in songs.csv`
      });
    }

    if (!isBlank(providerId) && !providerIds.has(providerId)) {
      issues.push({
        severity: "error",
        file: "karaoke_entries.csv",
        row: entry.rowNumber,
        message: `provider_id ${providerId} not found in karaoke_providers.csv`
      });
    }
  }
}

function validateAliasSearchFields(
  aliases: CsvRecord[],
  issues: SeedValidationIssue[]
): void {
  for (const alias of aliases) {
    if (isBlank(alias.values.alias)) {
      continue;
    }

    const searchFields = buildAliasSearchFields(alias.values.alias);

    if (
      !isBlank(alias.values.normalized_alias) &&
      alias.values.normalized_alias !== searchFields.normalizedAlias
    ) {
      issues.push({
        severity: "error",
        file: "song_aliases.csv",
        row: alias.rowNumber,
        message: `normalized_alias must be ${searchFields.normalizedAlias}`
      });
    }

    if (!isBlank(alias.values.chosung_alias)) {
      if (alias.values.chosung_alias !== searchFields.chosungAlias) {
        issues.push({
          severity: "error",
          file: "song_aliases.csv",
          row: alias.rowNumber,
          message: `chosung_alias must be ${searchFields.chosungAlias}`
        });
      }
    } else if (searchFields.chosungAlias === "") {
      continue;
    }
  }
}

function validateEntryStatusRules(
  entries: CsvRecord[],
  issues: SeedValidationIssue[],
  now: Date
): void {
  for (const entry of entries) {
    const status = entry.values.availability_status;
    const karaokeNumber = entry.values.karaoke_number;
    const lastVerifiedAt = entry.values.last_verified_at;
    const verifiedBy = entry.values.verified_by;

    if (status === "available") {
      requireEntryField(entry, "karaoke_number", karaokeNumber, issues);
      requireEntryField(entry, "last_verified_at", lastVerifiedAt, issues);
      requireEntryField(entry, "verified_by", verifiedBy, issues);
    }

    if (status === "not_available" || status === "temporarily_unavailable") {
      if (!isBlank(karaokeNumber)) {
        issues.push({
          severity: "error",
          file: "karaoke_entries.csv",
          row: entry.rowNumber,
          message: `karaoke_number must be empty when availability_status=${status}`
        });
      }

      requireEntryField(entry, "last_verified_at", lastVerifiedAt, issues);
      requireEntryField(entry, "verified_by", verifiedBy, issues);
    }

    if (status === "unknown" && !isBlank(karaokeNumber)) {
      issues.push({
        severity: "error",
        file: "karaoke_entries.csv",
        row: entry.rowNumber,
        message: "karaoke_number must be empty when availability_status=unknown"
      });
    }

    if (!isBlank(lastVerifiedAt)) {
      const parsed = parseDateOnly(lastVerifiedAt);

      if (parsed === null) {
        issues.push({
          severity: "error",
          file: "karaoke_entries.csv",
          row: entry.rowNumber,
          message: "last_verified_at must be YYYY-MM-DD"
        });
        continue;
      }

      const verifiedDaysAgo = daysBetween(parsed, now);

      if (verifiedDaysAgo < 0) {
        issues.push({
          severity: "error",
          file: "karaoke_entries.csv",
          row: entry.rowNumber,
          message: "last_verified_at must not be in the future"
        });
        continue;
      }

      if (verifiedDaysAgo > STALE_VERIFICATION_DAYS) {
        issues.push({
          severity: "warning",
          file: "karaoke_entries.csv",
          row: entry.rowNumber,
          message: "last_verified_at is older than 180 days"
        });
      }
    }
  }
}

function validateDuplicates(
  records: Map<SeedFileName, CsvRecord[]>,
  issues: SeedValidationIssue[]
): void {
  for (const file of SEED_FILE_NAMES) {
    reportDuplicateKeys(
      file,
      records.get(file) ?? [],
      (record) => record.values.id,
      "duplicate id",
      issues
    );
  }

  reportDuplicateKeys(
    "song_aliases.csv",
    records.get("song_aliases.csv") ?? [],
    (record) => {
      const normalizedAlias = isBlank(record.values.alias)
        ? record.values.normalized_alias
        : buildAliasSearchFields(record.values.alias).normalizedAlias;

      return [
        record.values.song_id,
        normalizedAlias,
        record.values.alias_type
      ].join("\u0000");
    },
    "duplicate song_id + normalized_alias + alias_type",
    issues
  );

  reportDuplicateKeys(
    "karaoke_entries.csv",
    records.get("karaoke_entries.csv") ?? [],
    (record) =>
      [
        record.values.song_id,
        record.values.provider_id,
        record.values.version_info,
        record.values.karaoke_number
      ].join("\u0000"),
    "duplicate song_id + provider_id + version_info + karaoke_number",
    issues
  );
}

function reportDuplicateKeys(
  file: SeedFileName,
  records: CsvRecord[],
  keyFor: (record: CsvRecord) => string,
  message: string,
  issues: SeedValidationIssue[]
): void {
  const firstRows = new Map<string, number>();

  for (const record of records) {
    const key = keyFor(record);

    if (key.split("\u0000").some(isBlank)) {
      continue;
    }

    const firstRow = firstRows.get(key);

    if (firstRow !== undefined) {
      issues.push({
        severity: "error",
        file,
        row: record.rowNumber,
        message: `${message} already used at row ${firstRow}`
      });
      continue;
    }

    firstRows.set(key, record.rowNumber);
  }
}

function requireEntryField(
  entry: CsvRecord,
  field: string,
  value: string,
  issues: SeedValidationIssue[]
): void {
  if (isBlank(value)) {
    issues.push({
      severity: "error",
      file: "karaoke_entries.csv",
      row: entry.rowNumber,
      message: `${field} is required when availability_status=${entry.values.availability_status}`
    });
  }
}

function parseDateOnly(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    return null;
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function daysBetween(past: Date, current: Date): number {
  return Math.floor(
    (startOfUtcDay(current).getTime() - past.getTime()) / DAY_MS
  );
}

function startOfUtcDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
}

function isBlank(value: string | undefined): boolean {
  return value === undefined || value.trim() === "";
}
