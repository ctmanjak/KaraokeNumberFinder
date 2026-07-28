import { Prisma, type PrismaClient } from "../generated/prisma/client";
import { normalizeDuplicateInput } from "./match";
import {
  DUPLICATE_CANDIDATE_LIMIT,
  DUPLICATE_MIN_PARTIAL_INPUT_LENGTH,
  DUPLICATE_STATEMENT_TIMEOUT_MS,
  type CandidateMatchEvidence,
  type CandidateSummary,
  type DuplicateCheckInput,
  type DuplicateCheckResult
} from "./types";

type DuplicateQueryDb = Pick<PrismaClient, "$executeRawUnsafe" | "$queryRaw">;

type CandidateRow = Readonly<{
  id: string;
  displayTitle: string;
  canonicalTitle: string;
  canonicalArtist: string;
  originalLanguage: string;
  releaseYear: number | null;
  tieIn: string | null;
  exactIdentity: boolean;
  titleStrength: number | null;
  titleInputField: string | null;
  titleCandidateField: string | null;
  titleMatchedValue: string | null;
  artistStrength: number | null;
  artistCandidateField: string | null;
  artistMatchedValue: string | null;
  providerSummary: unknown;
}>;

export class DuplicateCheckRepositoryError extends Error {
  constructor(readonly code: "TIMEOUT") {
    super(code);
    this.name = "DuplicateCheckRepositoryError";
  }
}

export async function findDuplicateCandidates(
  db: PrismaClient,
  input: DuplicateCheckInput
): Promise<DuplicateCheckResult> {
  try {
    return await db.$transaction((transaction) =>
      findDuplicateCandidatesInTransaction(transaction, input)
    );
  } catch (error) {
    if (isStatementTimeout(error)) {
      throw new DuplicateCheckRepositoryError("TIMEOUT");
    }
    throw error;
  }
}

export async function findDuplicateCandidatesInTransaction(
  db: DuplicateQueryDb,
  input: DuplicateCheckInput
): Promise<DuplicateCheckResult> {
  const normalized = normalizeDuplicateInput(input);
  await db.$executeRawUnsafe(
    `SET LOCAL statement_timeout = '${DUPLICATE_STATEMENT_TIMEOUT_MS}ms'`
  );
  const matchInputs = JSON.stringify([
    ...normalized.titles.map((title) => ({
      role: "title",
      value: title.value,
      input_field: title.inputField
    })),
    {
      role: "artist",
      value: normalized.canonicalArtist,
      input_field: "canonical_artist"
    }
  ]);
  const rows = await db.$queryRaw<CandidateRow[]>(Prisma.sql`
    WITH input_values AS (
      SELECT role, value, input_field
      FROM jsonb_to_recordset(${matchInputs}::jsonb)
        AS input(role text, value text, input_field text)
    ),
    candidate_values AS (
      SELECT
        song.id AS song_id,
        'title'::text AS role,
        song.normalized_canonical_title AS normalized_value,
        'song.canonical_title'::text AS candidate_field,
        song.canonical_title AS matched_value
      FROM songs AS song
      UNION ALL
      SELECT
        song.id,
        'artist',
        song.normalized_canonical_artist,
        'song.canonical_artist',
        song.canonical_artist
      FROM songs AS song
      UNION ALL
      SELECT
        alias.song_id,
        CASE WHEN alias.alias_type = 'artist'
             THEN 'artist' ELSE 'title' END,
        alias.normalized_alias,
        'alias.' || alias.alias_type::text,
        alias.alias
      FROM song_aliases AS alias
      JOIN songs AS alias_song ON alias_song.id = alias.song_id
      WHERE alias.alias_type IN (
        'canonical_title', 'display_title', 'romanized_title',
        'english_title', 'translated_title', 'abbreviation',
        'common_name', 'alternate_spelling', 'artist'
      )
        AND (
          alias.alias_type <> 'artist'
          OR alias.normalized_alias <> alias_song.normalized_canonical_artist
        )
    ),
    scored_values AS (
      SELECT
        candidate.song_id,
        candidate.role,
        input.input_field,
        candidate.candidate_field,
        candidate.matched_value,
        CASE
          WHEN candidate.normalized_value = input.value THEN 3
          WHEN char_length(input.value) >= ${DUPLICATE_MIN_PARTIAL_INPUT_LENGTH}
            AND strpos(candidate.normalized_value, input.value) = 1 THEN 2
          ELSE 1
        END AS strength
      FROM candidate_values AS candidate
      JOIN input_values AS input
        ON input.role = candidate.role
       AND (
         candidate.normalized_value = input.value
         OR (
           char_length(input.value) >= ${DUPLICATE_MIN_PARTIAL_INPUT_LENGTH}
           AND strpos(candidate.normalized_value, input.value) = 1
         )
         OR (
           char_length(input.value) >= ${DUPLICATE_MIN_PARTIAL_INPUT_LENGTH}
           AND strpos(candidate.normalized_value, input.value) > 0
         )
       )
    ),
    best_values AS (
      SELECT DISTINCT ON (song_id, role)
        song_id, role, strength, input_field, candidate_field, matched_value
      FROM scored_values
      ORDER BY song_id ASC, role ASC, strength DESC, input_field ASC,
               candidate_field ASC, matched_value ASC
    ),
    best_title AS (
      SELECT song_id, strength, input_field, candidate_field, matched_value
      FROM best_values
      WHERE role = 'title'
    ),
    best_artist AS (
      SELECT song_id, strength, candidate_field, matched_value
      FROM best_values
      WHERE role = 'artist'
      ORDER BY song_id ASC, strength DESC, candidate_field ASC,
               matched_value ASC
    ),
    ranked AS (
      SELECT
        song.id,
        song.display_title AS "displayTitle",
        song.canonical_title AS "canonicalTitle",
        song.canonical_artist AS "canonicalArtist",
        song.original_language AS "originalLanguage",
        song.release_year AS "releaseYear",
        song.tie_in AS "tieIn",
        (
          song.normalized_canonical_title = ${normalized.canonicalTitle}
          AND song.normalized_canonical_artist = ${normalized.canonicalArtist}
        ) AS "exactIdentity",
        title.strength AS "titleStrength",
        title.input_field AS "titleInputField",
        title.candidate_field AS "titleCandidateField",
        title.matched_value AS "titleMatchedValue",
        artist.strength AS "artistStrength",
        artist.candidate_field AS "artistCandidateField",
        artist.matched_value AS "artistMatchedValue"
      FROM songs AS song
      LEFT JOIN best_title AS title ON title.song_id = song.id
      LEFT JOIN best_artist AS artist ON artist.song_id = song.id
      WHERE (title.song_id IS NOT NULL OR artist.song_id IS NOT NULL)
        AND (${input.exclude_song_id ?? null}::text IS NULL
             OR song.id <> ${input.exclude_song_id ?? null})
      ORDER BY
        (
          song.normalized_canonical_title = ${normalized.canonicalTitle}
          AND song.normalized_canonical_artist = ${normalized.canonicalArtist}
        ) DESC,
        (title.strength IS NOT NULL AND artist.strength IS NOT NULL) DESC,
        COALESCE(title.strength, 0) DESC,
        COALESCE(artist.strength, 0) DESC,
        song.id ASC
      LIMIT ${DUPLICATE_CANDIDATE_LIMIT}
    )
    SELECT
      ranked.*,
      COALESCE(provider_rows.summary, '[]'::jsonb) AS "providerSummary"
    FROM ranked
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(
        jsonb_build_object(
          'provider_id', entry.provider_id,
          'provider_name', provider.name,
          'karaoke_number', entry.karaoke_number,
          'version_info', entry.version_info
        )
        ORDER BY provider.display_order ASC, provider.name ASC,
                 entry.version_info ASC, entry.karaoke_number ASC, entry.id ASC
      ) AS summary
      FROM karaoke_entries AS entry
      JOIN karaoke_providers AS provider ON provider.id = entry.provider_id
      WHERE entry.song_id = ranked.id
    ) AS provider_rows ON TRUE
    ORDER BY
      ranked."exactIdentity" DESC,
      (ranked."titleStrength" IS NOT NULL
       AND ranked."artistStrength" IS NOT NULL) DESC,
      COALESCE(ranked."titleStrength", 0) DESC,
      COALESCE(ranked."artistStrength", 0) DESC,
      ranked.id ASC
  `);
  await db.$executeRawUnsafe("SET LOCAL statement_timeout = '0'");

  const candidates = rows.map(toCandidateSummary);
  const exact = rows
    .map((row, index) => ({ row, candidate: candidates[index] }))
    .filter((item) => item.row.exactIdentity)
    .map((item) => item.candidate);
  if (exact.length > 0) {
    return { classification: "exact", candidates: exact };
  }
  return candidates.length === 0
    ? { classification: "none", candidates: [] }
    : { classification: "possible", candidates };
}

function toCandidateSummary(row: CandidateRow): CandidateSummary {
  const evidence: CandidateMatchEvidence[] = [];
  if (
    row.titleStrength !== null &&
    row.titleInputField !== null &&
    row.titleCandidateField !== null &&
    row.titleMatchedValue !== null
  ) {
    evidence.push({
      role: "title",
      strength: strengthName(row.titleStrength),
      input_field:
        row.titleInputField === "display_title"
          ? "display_title"
          : "canonical_title",
      candidate_field: row.titleCandidateField,
      matched_value: row.titleMatchedValue
    });
  }
  if (
    row.artistStrength !== null &&
    row.artistCandidateField !== null &&
    row.artistMatchedValue !== null
  ) {
    evidence.push({
      role: "artist",
      strength: strengthName(row.artistStrength),
      input_field: "canonical_artist",
      candidate_field: row.artistCandidateField,
      matched_value: row.artistMatchedValue
    });
  }
  const providerSummary = Array.isArray(row.providerSummary)
    ? row.providerSummary.filter(isProviderSummary)
    : [];
  return {
    id: row.id,
    display_title: row.displayTitle,
    canonical_title: row.canonicalTitle,
    canonical_artist: row.canonicalArtist,
    original_language: row.originalLanguage,
    release_year: row.releaseYear,
    tie_in: row.tieIn,
    provider_summary: providerSummary,
    match_evidence: evidence,
    admin_path: `/admin/songs/${encodeURIComponent(row.id)}`
  };
}

function strengthName(value: number): "exact" | "prefix" | "partial" {
  if (value === 3) return "exact";
  if (value === 2) return "prefix";
  return "partial";
}

function isProviderSummary(
  value: unknown
): value is CandidateSummary["provider_summary"][number] {
  return (
    typeof value === "object" &&
    value !== null &&
    "provider_id" in value &&
    typeof value.provider_id === "string" &&
    "provider_name" in value &&
    typeof value.provider_name === "string" &&
    "karaoke_number" in value &&
    typeof value.karaoke_number === "string" &&
    "version_info" in value &&
    typeof value.version_info === "string"
  );
}

export function isStatementTimeout(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5; depth += 1) {
    if (
      typeof current === "object" &&
      current !== null &&
      "code" in current &&
      current.code === "57014"
    ) {
      return true;
    }
    if (
      typeof current === "object" &&
      current !== null &&
      "code" in current &&
      current.code === "P2010" &&
      "meta" in current
    ) {
      const metadata = JSON.stringify(current.meta);
      if (
        metadata.includes("57014") &&
        /statement timeout|canceling statement/iu.test(metadata)
      ) {
        return true;
      }
    }
    current =
      typeof current === "object" && current !== null && "cause" in current
        ? current.cause
        : undefined;
  }
  return false;
}
