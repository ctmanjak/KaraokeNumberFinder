import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { buildAliasSearchFields } from "../search/normalize";
import { writeCsvRows } from "../seed/csv";
import { SEED_FILE_HEADERS } from "../seed/validate";

export type SyntheticDatasetLabel =
  "synthetic-1k-songs-10k-aliases" | "synthetic-10k-songs-100k-aliases";

export type SyntheticDatasetConfig = {
  label: SyntheticDatasetLabel;
  idPrefix: string;
  songCount: number;
  aliasCount: number;
  providerCount: number;
  randomSeed: number;
  generatorVersion: "synthetic-search-v1";
  deterministicGeneratedAt: string;
};

export type SyntheticDatasetMetadata = {
  schema_version: 1;
  dataset_label: SyntheticDatasetLabel;
  generator_version: string;
  random_seed: number;
  generated_at: string;
  row_counts: {
    songs: number;
    song_aliases: number;
    karaoke_entries: number;
    karaoke_providers: number;
    search_fixture_cases: number;
  };
  fixture_path: string;
  required_case_ids: string[];
  notes: string[];
};

export type SyntheticDatasetResult = {
  outputDir: string;
  metadata: SyntheticDatasetMetadata;
  sampleIds: {
    firstSongId: string;
    firstAliasId: string;
    highEntrySongId: string;
    validProviderId: string;
  };
};

type ProviderRow = Record<
  (typeof SEED_FILE_HEADERS)["karaoke_providers.csv"][number],
  string
>;
type SongRow = Record<(typeof SEED_FILE_HEADERS)["songs.csv"][number], string>;
type AliasRow = Record<
  (typeof SEED_FILE_HEADERS)["song_aliases.csv"][number],
  string
>;
type EntryRow = Record<
  (typeof SEED_FILE_HEADERS)["karaoke_entries.csv"][number],
  string
>;

type SearchFixtureRow = {
  case_id: string;
  label: string;
  query: string;
  expected_song_id: string;
  expected_match_type: string;
  provider_id: string;
  dataset_label: string;
  notes: string;
};

export const SYNTHETIC_GENERATOR_VERSION = "synthetic-search-v1";
export const SYNTHETIC_SEARCH_FIXTURE_FILE = "search-synthetic-scale.csv";
export const SYNTHETIC_METADATA_FILE = "dataset-metadata.json";
export const DEFAULT_SYNTHETIC_OUTPUT_ROOT = path.join(
  "tmp",
  "synthetic-datasets"
);

export const REQUIRED_SYNTHETIC_CASE_IDS = [
  "normalized-exact",
  "normalized-prefix",
  "normalized-contains",
  "hangul-chosung-prefix",
  "no-result-suggestions",
  "valid-provider-filter",
  "invalid-provider-filter",
  "high-candidate-partial-query",
  "high-entry-count-song-payload"
] as const;

const SYNTHETIC_DATASET_CONFIGS = {
  "synthetic-1k-songs-10k-aliases": {
    label: "synthetic-1k-songs-10k-aliases",
    idPrefix: "synthetic_1k",
    songCount: 1_000,
    aliasCount: 10_000,
    providerCount: 6,
    randomSeed: 1009,
    generatorVersion: SYNTHETIC_GENERATOR_VERSION,
    deterministicGeneratedAt: "2026-07-06T00:00:00.000Z"
  },
  "synthetic-10k-songs-100k-aliases": {
    label: "synthetic-10k-songs-100k-aliases",
    idPrefix: "synthetic_10k",
    songCount: 10_000,
    aliasCount: 100_000,
    providerCount: 12,
    randomSeed: 10009,
    generatorVersion: SYNTHETIC_GENERATOR_VERSION,
    deterministicGeneratedAt: "2026-07-06T00:00:00.000Z"
  }
} as const satisfies Record<SyntheticDatasetLabel, SyntheticDatasetConfig>;

const ALIAS_TYPES = [
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
] as const;

const FIXTURE_SONG_INDEX = {
  exact: 1,
  prefix: 2,
  contains: 3,
  chosung: 4,
  suggestion: 5,
  provider: 6,
  pressure: 7,
  highEntry: 8
} as const;

export function syntheticDatasetConfigFor(
  label: string
): SyntheticDatasetConfig {
  if (isSyntheticDatasetLabel(label)) {
    return SYNTHETIC_DATASET_CONFIGS[label];
  }

  throw new Error(
    `unsupported synthetic dataset label ${label}. Supported labels: ${Object.keys(
      SYNTHETIC_DATASET_CONFIGS
    ).join(", ")}`
  );
}

export function isSyntheticDatasetLabel(
  label: string
): label is SyntheticDatasetLabel {
  return Object.hasOwn(SYNTHETIC_DATASET_CONFIGS, label);
}

export function generateSyntheticDataset(options: {
  datasetLabel: SyntheticDatasetLabel;
  outputRoot?: string;
}): SyntheticDatasetResult {
  const config = syntheticDatasetConfigFor(options.datasetLabel);
  const outputDir = path.join(
    options.outputRoot ?? DEFAULT_SYNTHETIC_OUTPUT_ROOT,
    config.label
  );

  mkdirSync(outputDir, { recursive: true });

  const providers = buildProviders(config);
  const songs = buildSongs(config);
  const aliases = buildAliases(config);
  const entries = buildEntries(config);
  const fixture = buildSearchFixture(config);

  writeCsvRows(
    path.join(outputDir, "karaoke_providers.csv"),
    rowsForCsv(SEED_FILE_HEADERS["karaoke_providers.csv"], providers)
  );
  writeCsvRows(
    path.join(outputDir, "songs.csv"),
    rowsForCsv(SEED_FILE_HEADERS["songs.csv"], songs)
  );
  writeCsvRows(
    path.join(outputDir, "song_aliases.csv"),
    rowsForCsv(SEED_FILE_HEADERS["song_aliases.csv"], aliases)
  );
  writeCsvRows(
    path.join(outputDir, "karaoke_entries.csv"),
    rowsForCsv(SEED_FILE_HEADERS["karaoke_entries.csv"], entries)
  );
  writeCsvRows(
    path.join(outputDir, SYNTHETIC_SEARCH_FIXTURE_FILE),
    rowsForCsv(
      [
        "case_id",
        "label",
        "query",
        "expected_song_id",
        "expected_match_type",
        "provider_id",
        "dataset_label",
        "notes"
      ],
      fixture
    )
  );

  const metadata: SyntheticDatasetMetadata = {
    schema_version: 1,
    dataset_label: config.label,
    generator_version: config.generatorVersion,
    random_seed: config.randomSeed,
    generated_at: config.deterministicGeneratedAt,
    row_counts: {
      songs: songs.length,
      song_aliases: aliases.length,
      karaoke_entries: entries.length,
      karaoke_providers: providers.length,
      search_fixture_cases: fixture.length
    },
    fixture_path: SYNTHETIC_SEARCH_FIXTURE_FILE,
    required_case_ids: [...REQUIRED_SYNTHETIC_CASE_IDS],
    notes: [
      "Generated for local/sandbox synthetic search scale testing only.",
      "Do not import this dataset into Neon, live, production, or production-like databases.",
      "Timestamps are deterministic to keep repeated generation byte-stable."
    ]
  };

  writeFileSync(
    path.join(outputDir, SYNTHETIC_METADATA_FILE),
    `${JSON.stringify(metadata, null, 2)}\n`,
    "utf8"
  );

  return {
    outputDir,
    metadata,
    sampleIds: {
      firstSongId: songId(config, 1),
      firstAliasId: aliasId(config, 1, 1),
      highEntrySongId: songId(config, FIXTURE_SONG_INDEX.highEntry),
      validProviderId: providerId(config, 1)
    }
  };
}

function buildProviders(config: SyntheticDatasetConfig): ProviderRow[] {
  return Array.from({ length: config.providerCount }, (_, index) => {
    const ordinal = index + 1;
    const inactive = ordinal === config.providerCount;

    return {
      id: providerId(config, ordinal),
      name: `Synthetic Provider ${config.idPrefix.toUpperCase()} ${pad(ordinal, 2)}`,
      country: ordinal % 3 === 0 ? "JP" : ordinal % 3 === 1 ? "KR" : "US",
      is_active: inactive ? "false" : "true",
      display_order: String(ordinal * 10),
      is_default: ordinal === 1 ? "true" : "false",
      source_url: "",
      source_name: "synthetic-generator",
      verified_by: "synthetic-generator",
      verification_note: config.label
    };
  });
}

function buildSongs(config: SyntheticDatasetConfig): SongRow[] {
  return Array.from({ length: config.songCount }, (_, index) => {
    const ordinal = index + 1;
    const fixtureTitle = fixtureDisplayTitle(ordinal);

    return {
      id: songId(config, ordinal),
      original_language: languageFor(ordinal),
      canonical_title: `Synthetic Canonical ${config.idPrefix} ${pad(ordinal, 6)}`,
      display_title:
        fixtureTitle ??
        `Synthetic ${languageFor(ordinal).toUpperCase()} Title ${pad(ordinal, 6)}`,
      canonical_artist: artistFor(ordinal),
      release_year: releaseYearFor(ordinal),
      tie_in: tieInFor(ordinal),
      source_url: "",
      source_name: "synthetic-generator",
      verified_by: "synthetic-generator",
      verification_note: config.label
    };
  });
}

function buildAliases(config: SyntheticDatasetConfig): AliasRow[] {
  const aliases: AliasRow[] = [];

  for (let songOrdinal = 1; songOrdinal <= config.songCount; songOrdinal += 1) {
    for (
      let aliasOrdinal = 1;
      aliasOrdinal <= ALIAS_TYPES.length;
      aliasOrdinal += 1
    ) {
      const aliasType = ALIAS_TYPES[aliasOrdinal - 1];
      aliases.push(
        buildAlias(
          config,
          songOrdinal,
          aliasOrdinal,
          aliasType,
          aliasTextFor(config, songOrdinal, aliasType)
        )
      );
    }
  }

  if (aliases.length !== config.aliasCount) {
    throw new Error(
      `${config.label} generated ${aliases.length} aliases, expected ${config.aliasCount}`
    );
  }

  return aliases;
}

function buildAlias(
  config: SyntheticDatasetConfig,
  songOrdinal: number,
  aliasOrdinal: number,
  aliasType: (typeof ALIAS_TYPES)[number],
  alias: string
): AliasRow {
  const searchFields = buildAliasSearchFields(alias);

  return {
    id: aliasId(config, songOrdinal, aliasOrdinal),
    song_id: songId(config, songOrdinal),
    alias,
    language: languageFor(songOrdinal),
    alias_type: aliasType,
    normalized_alias: searchFields.normalizedAlias,
    chosung_alias: searchFields.chosungAlias,
    source_url: "",
    source_name: "synthetic-generator",
    verified_by: "synthetic-generator",
    verification_note: config.label
  };
}

function buildEntries(config: SyntheticDatasetConfig): EntryRow[] {
  const entries: EntryRow[] = [];
  const activeProviderCount = config.providerCount - 1;

  for (let songOrdinal = 1; songOrdinal <= config.songCount; songOrdinal += 1) {
    const fanout =
      songOrdinal === FIXTURE_SONG_INDEX.highEntry
        ? Math.min(
            activeProviderCount * 2,
            config.label.includes("10k") ? 22 : 10
          )
        : songOrdinal % 20 === 0
          ? 4
          : songOrdinal % 5 === 0
            ? 3
            : 2;

    for (let entryOrdinal = 1; entryOrdinal <= fanout; entryOrdinal += 1) {
      const providerOrdinal = ((entryOrdinal - 1) % activeProviderCount) + 1;
      const version =
        entryOrdinal > activeProviderCount
          ? `Live ${entryOrdinal - activeProviderCount}`
          : "Original";
      const status = availabilityStatusFor(songOrdinal, entryOrdinal);

      entries.push({
        id: entryId(config, songOrdinal, entryOrdinal),
        song_id: songId(config, songOrdinal),
        provider_id: providerId(config, providerOrdinal),
        karaoke_number:
          status === "available"
            ? `${config.randomSeed}${pad(songOrdinal, 6)}${pad(entryOrdinal, 2)}`
            : "",
        version_info: version,
        availability_status: status,
        last_verified_at: status === "unknown" ? "" : "2026-07-01",
        source_url: "",
        source_name: "synthetic-generator",
        verified_by: status === "unknown" ? "" : "synthetic-generator",
        verification_note: config.label
      });
    }
  }

  return entries;
}

function buildSearchFixture(
  config: SyntheticDatasetConfig
): SearchFixtureRow[] {
  const row = (
    caseId: (typeof REQUIRED_SYNTHETIC_CASE_IDS)[number],
    label: string,
    query: string,
    expectedSongOrdinal: number,
    expectedMatchType: string,
    provider = "",
    notes = ""
  ): SearchFixtureRow => ({
    case_id: caseId,
    label,
    query,
    expected_song_id: songId(config, expectedSongOrdinal),
    expected_match_type: expectedMatchType,
    provider_id: provider,
    dataset_label: config.label,
    notes
  });

  return [
    row(
      "normalized-exact",
      "Normalized exact",
      "Neon exact anthem",
      FIXTURE_SONG_INDEX.exact,
      "exact"
    ),
    row(
      "normalized-prefix",
      "Normalized prefix",
      "star pressure prefix 000002",
      FIXTURE_SONG_INDEX.prefix,
      "prefix"
    ),
    row(
      "normalized-contains",
      "Normalized contains",
      "middlecore000003",
      FIXTURE_SONG_INDEX.contains,
      "contains"
    ),
    row(
      "hangul-chosung-prefix",
      "Hangul chosung prefix",
      "ㅅㅌ",
      FIXTURE_SONG_INDEX.chosung,
      "chosung"
    ),
    row(
      "no-result-suggestions",
      "No-result suggestions",
      "near misss melody",
      FIXTURE_SONG_INDEX.suggestion,
      "suggestion",
      "",
      "Generated aliases contain a nearby spelling but not this exact query."
    ),
    row(
      "valid-provider-filter",
      "Valid provider filter",
      "provider filter anthem",
      FIXTURE_SONG_INDEX.provider,
      "provider-filter",
      providerId(config, 1)
    ),
    row(
      "invalid-provider-filter",
      "Invalid provider filter",
      "provider filter anthem",
      FIXTURE_SONG_INDEX.provider,
      "invalid-provider",
      "synthetic_missing_provider"
    ),
    row(
      "high-candidate-partial-query",
      "High candidate partial query",
      "star",
      FIXTURE_SONG_INDEX.pressure,
      "partial-pressure"
    ),
    row(
      "high-entry-count-song-payload",
      "High entry-count payload",
      "payload fanout anthem",
      FIXTURE_SONG_INDEX.highEntry,
      "payload-fanout"
    )
  ];
}

function aliasTextFor(
  config: SyntheticDatasetConfig,
  songOrdinal: number,
  aliasType: (typeof ALIAS_TYPES)[number]
): string {
  const fixture = fixtureAliasText(songOrdinal, aliasType);
  if (fixture !== null) {
    return fixture;
  }

  const numeric = pad(songOrdinal, 6);
  const starPressure =
    songOrdinal <= Math.min(config.songCount, 1_500)
      ? `Star Pressure Shared ${numeric}`
      : `Synthetic Unique ${numeric}`;

  switch (aliasType) {
    case "canonical_title":
      return `Synthetic Canonical ${config.idPrefix} ${numeric}`;
    case "display_title":
      return `Synthetic Display ${numeric}`;
    case "artist":
      return artistFor(songOrdinal);
    case "romanized_title":
      return `${starPressure} Romanized`;
    case "english_title":
      return `English Synthetic ${numeric}`;
    case "translated_title":
      return `Translated Middle Core ${numeric}`;
    case "content":
      return `Synthetic Series ${pad(songOrdinal % 250, 3)} Insert ${numeric}`;
    case "abbreviation":
      return `SYN ${numeric}`;
    case "common_name":
      return `Common Synthetic Name ${numeric}`;
    case "alternate_spelling":
      return `Synthetic Alternate Spelling ${numeric}`;
  }
}

function fixtureAliasText(
  songOrdinal: number,
  aliasType: (typeof ALIAS_TYPES)[number]
): string | null {
  if (
    songOrdinal === FIXTURE_SONG_INDEX.exact &&
    aliasType === "display_title"
  ) {
    return "Neon exact anthem";
  }
  if (
    songOrdinal === FIXTURE_SONG_INDEX.prefix &&
    aliasType === "romanized_title"
  ) {
    return "Star Pressure Prefix 000002 Prime";
  }
  if (
    songOrdinal === FIXTURE_SONG_INDEX.contains &&
    aliasType === "translated_title"
  ) {
    return "Synthetic middlecore000003 bridge";
  }
  if (
    songOrdinal === FIXTURE_SONG_INDEX.chosung &&
    aliasType === "display_title"
  ) {
    return "스타 합창곡";
  }
  if (
    songOrdinal === FIXTURE_SONG_INDEX.suggestion &&
    aliasType === "alternate_spelling"
  ) {
    return "near miss melody";
  }
  if (
    songOrdinal === FIXTURE_SONG_INDEX.provider &&
    aliasType === "display_title"
  ) {
    return "provider filter anthem";
  }
  if (
    songOrdinal === FIXTURE_SONG_INDEX.pressure &&
    aliasType === "romanized_title"
  ) {
    return "Star Pressure Shared 000007";
  }
  if (
    songOrdinal === FIXTURE_SONG_INDEX.highEntry &&
    aliasType === "display_title"
  ) {
    return "payload fanout anthem";
  }

  return null;
}

function fixtureDisplayTitle(songOrdinal: number): string | null {
  if (songOrdinal === FIXTURE_SONG_INDEX.chosung) {
    return "스타 합창곡";
  }
  if (songOrdinal === FIXTURE_SONG_INDEX.highEntry) {
    return "Payload Fanout Anthem";
  }
  return null;
}

function languageFor(songOrdinal: number): string {
  const bucket = songOrdinal % 20;
  if (bucket < 7) {
    return "ja";
  }
  if (bucket < 14) {
    return "ko";
  }
  if (bucket < 18) {
    return "en";
  }
  return "multi";
}

function releaseYearFor(songOrdinal: number): string {
  if (songOrdinal % 37 === 0) {
    return "";
  }
  return String(1990 + (songOrdinal % 37));
}

function tieInFor(songOrdinal: number): string {
  const bucket = songOrdinal % 20;
  if (bucket < 8) {
    return "";
  }
  if (bucket < 12) {
    return `Synthetic Anime ${pad(songOrdinal % 100, 3)}`;
  }
  if (bucket < 15) {
    return `Synthetic Drama ${pad(songOrdinal % 100, 3)}`;
  }
  if (bucket < 17) {
    return `Synthetic Game ${pad(songOrdinal % 100, 3)}`;
  }
  if (bucket < 19) {
    return `Synthetic Movie ${pad(songOrdinal % 100, 3)}`;
  }
  return `Synthetic Other ${pad(songOrdinal % 100, 3)}`;
}

function artistFor(songOrdinal: number): string {
  return songOrdinal % 4 === 0
    ? `Shared Artist Family ${pad(songOrdinal % 125, 3)}`
    : `Synthetic Artist ${pad(songOrdinal, 6)}`;
}

function availabilityStatusFor(
  songOrdinal: number,
  entryOrdinal: number
): string {
  if (songOrdinal % 113 === 0 && entryOrdinal === 1) {
    return "unknown";
  }
  if (songOrdinal % 71 === 0 && entryOrdinal === 1) {
    return "temporarily_unavailable";
  }
  if (songOrdinal % 53 === 0 && entryOrdinal === 1) {
    return "not_available";
  }
  return "available";
}

function rowsForCsv<T extends Record<string, string>>(
  header: readonly (keyof T & string)[],
  rows: readonly T[]
): string[][] {
  return [
    [...header],
    ...rows.map((row) => header.map((column) => row[column]))
  ];
}

function songId(config: SyntheticDatasetConfig, ordinal: number): string {
  return `${config.idPrefix}_song_${pad(ordinal, 6)}`;
}

function aliasId(
  config: SyntheticDatasetConfig,
  songOrdinal: number,
  aliasOrdinal: number
): string {
  return `${config.idPrefix}_alias_${pad(songOrdinal, 6)}_${pad(aliasOrdinal, 2)}`;
}

function entryId(
  config: SyntheticDatasetConfig,
  songOrdinal: number,
  entryOrdinal: number
): string {
  return `${config.idPrefix}_entry_${pad(songOrdinal, 6)}_${pad(entryOrdinal, 2)}`;
}

function providerId(config: SyntheticDatasetConfig, ordinal: number): string {
  return `${config.idPrefix}_provider_${pad(ordinal, 2)}`;
}

function pad(value: number, length: number): string {
  return String(value).padStart(length, "0");
}
