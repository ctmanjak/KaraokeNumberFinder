import { createHash } from "node:crypto";

import type { PoolClient } from "pg";

import { ADMIN_SYSTEM_ALIAS_TYPES } from "../admin-song/types";
import { buildAliasSearchFields } from "../search/normalize";
import { normalizeSongIdentity } from "./normalize";

type RepairClient = Pick<PoolClient, "query">;
type SystemAliasType = (typeof ADMIN_SYSTEM_ALIAS_TYPES)[number];

type RepairSongRow = Readonly<{
  id: string;
  original_language: string;
  canonical_title: string;
  display_title: string;
  canonical_artist: string;
  source_url: string | null;
  source_name: string | null;
  verified_by: string;
  verification_note: string | null;
}>;

type RepairAliasRow = Readonly<{
  id: string;
  song_id: string;
  alias_type: SystemAliasType;
  normalized_alias: string;
}>;

type RepairCandidate = Readonly<{
  id: string;
  songId: string;
  alias: string;
  language: string;
  aliasType: SystemAliasType;
  normalizedAlias: string;
  chosungAlias: string | null;
  sourceUrl: string | null;
  sourceName: string | null;
  verifiedBy: string;
  verificationNote: string | null;
}>;

export type SystemAliasRepairPlan = Readonly<{
  song_count: number;
  create_count: number;
  creates: ReadonlyArray<{
    id: string;
    song_id: string;
    alias_type: SystemAliasType;
  }>;
  blockers: ReadonlyArray<
    | { code: "EMPTY_IDENTITY"; song_id: string }
    | { code: "EXACT_DUPLICATE"; song_ids: readonly string[] }
    | {
        code: "AMBIGUOUS_SYSTEM_ALIAS";
        song_id: string;
        alias_type: SystemAliasType;
        matching_count: number;
      }
    | {
        code: "CANDIDATE_ID_CONFLICT";
        song_id: string;
        alias_type: SystemAliasType;
        alias_id: string;
      }
  >;
}>;

export type SystemAliasRepairResult = Readonly<{
  applied: boolean;
  before: SystemAliasRepairPlan;
  after: SystemAliasRepairPlan;
}>;

export async function repairMissingSystemAliases(
  client: RepairClient,
  options: Readonly<{
    apply?: boolean;
    expectedCreateCount?: number;
  }> = {}
): Promise<SystemAliasRepairResult> {
  const apply = options.apply === true;
  await client.query(apply ? "BEGIN" : "BEGIN TRANSACTION READ ONLY");
  let transactionOpen = true;
  try {
    await client.query("SET LOCAL statement_timeout = '15s'");
    if (apply) {
      await client.query(
        "LOCK TABLE songs, song_aliases IN SHARE ROW EXCLUSIVE MODE"
      );
    }
    const beforeState = await readRepairState(client);
    assertRepairable(beforeState.plan, options.expectedCreateCount);

    if (!apply) {
      await client.query("ROLLBACK");
      transactionOpen = false;
      return {
        applied: false,
        before: beforeState.plan,
        after: beforeState.plan
      };
    }

    for (const candidate of beforeState.candidates) {
      const insert = await client.query(
        `
          INSERT INTO song_aliases (
            id,
            song_id,
            alias,
            language,
            alias_type,
            normalized_alias,
            chosung_alias,
            source_url,
            source_name,
            verified_by,
            verification_note,
            updated_at
          ) VALUES ($1, $2, $3, $4, $5::alias_type, $6, $7, $8, $9, $10, $11, now())
        `,
        [
          candidate.id,
          candidate.songId,
          candidate.alias,
          candidate.language,
          candidate.aliasType,
          candidate.normalizedAlias,
          candidate.chosungAlias,
          candidate.sourceUrl,
          candidate.sourceName,
          candidate.verifiedBy,
          candidate.verificationNote
        ]
      );
      if (insert.rowCount !== 1) {
        throw new Error("System alias repair insert count was not one.");
      }
    }

    const afterState = await readRepairState(client);
    if (
      afterState.plan.blockers.length > 0 ||
      afterState.plan.create_count > 0
    ) {
      throw new Error("System alias verification failed after repair.");
    }
    await client.query("COMMIT");
    transactionOpen = false;
    return { applied: true, before: beforeState.plan, after: afterState.plan };
  } catch (error) {
    if (transactionOpen) {
      await client.query("ROLLBACK");
    }
    throw error;
  }
}

export type SafeRepairDatabaseTarget = Readonly<{
  hostname: string;
  port: string;
  database: string;
  schema: string;
  fingerprint: string;
}>;

export function safeRepairDatabaseTarget(
  databaseUrl: string
): SafeRepairDatabaseTarget {
  const parsed = new URL(databaseUrl);
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    throw new Error("System alias repair requires PostgreSQL.");
  }
  const target = {
    hostname: parsed.hostname,
    port: parsed.port || "5432",
    database: decodeURIComponent(parsed.pathname.replace(/^\//u, "")),
    schema: parsed.searchParams.get("schema") ?? "public"
  };
  const fingerprint = createHash("sha256")
    .update(
      [
        parsed.protocol,
        target.hostname,
        target.port,
        target.database,
        target.schema
      ].join("|")
    )
    .digest("hex");
  return { ...target, fingerprint };
}

export function requireSystemAliasRepairApplyAuthorization(options: {
  apply: boolean;
  confirmation: string | undefined;
  expectedTargetFingerprint: string | undefined;
  actualTargetFingerprint: string;
  expectedCreateCount: number | undefined;
}): void {
  if (!options.apply) return;
  if (
    options.confirmation !== "1" ||
    options.expectedTargetFingerprint === undefined ||
    options.expectedTargetFingerprint !== options.actualTargetFingerprint ||
    options.expectedCreateCount === undefined
  ) {
    throw new Error(
      "Apply requires explicit confirmation, the exact dry-run target fingerprint, and an expected create count."
    );
  }
}

async function readRepairState(client: RepairClient): Promise<{
  plan: SystemAliasRepairPlan;
  candidates: readonly RepairCandidate[];
}> {
  const songs = await client.query<RepairSongRow>(`
    SELECT
      id,
      original_language,
      canonical_title,
      display_title,
      canonical_artist,
      source_url,
      source_name,
      verified_by,
      verification_note
    FROM songs
    ORDER BY id ASC
  `);
  const aliases = await client.query<RepairAliasRow>(
    `
    SELECT id, song_id, alias_type::text, normalized_alias
    FROM song_aliases
    WHERE alias_type = ANY($1::alias_type[])
    ORDER BY song_id ASC, alias_type ASC, id ASC
  `,
    [ADMIN_SYSTEM_ALIAS_TYPES]
  );
  const provisional = buildRepairState(songs.rows, aliases.rows, new Set());
  const candidateIds = provisional.candidates.map((candidate) => candidate.id);
  const conflictingIds =
    candidateIds.length === 0
      ? new Set<string>()
      : new Set(
          (
            await client.query<{ id: string }>(
              "SELECT id FROM song_aliases WHERE id = ANY($1::text[]) ORDER BY id ASC",
              [candidateIds]
            )
          ).rows.map((row) => row.id)
        );
  return buildRepairState(songs.rows, aliases.rows, conflictingIds);
}

function buildRepairState(
  songs: readonly RepairSongRow[],
  aliases: readonly RepairAliasRow[],
  conflictingIds: ReadonlySet<string>
): {
  plan: SystemAliasRepairPlan;
  candidates: readonly RepairCandidate[];
} {
  const aliasesBySong = new Map<string, RepairAliasRow[]>();
  for (const alias of aliases) {
    const values = aliasesBySong.get(alias.song_id) ?? [];
    values.push(alias);
    aliasesBySong.set(alias.song_id, values);
  }

  const candidates: RepairCandidate[] = [];
  const blockers: SystemAliasRepairPlan["blockers"][number][] = [];
  const identityGroups = new Map<string, string[]>();
  for (const song of songs) {
    let identity;
    try {
      identity = normalizeSongIdentity({
        canonical_title: song.canonical_title,
        canonical_artist: song.canonical_artist
      });
    } catch {
      blockers.push({ code: "EMPTY_IDENTITY", song_id: song.id });
      continue;
    }
    const identityKey = `${identity.normalizedCanonicalTitle}\u0000${identity.normalizedCanonicalArtist}`;
    const group = identityGroups.get(identityKey) ?? [];
    group.push(song.id);
    identityGroups.set(identityKey, group);

    const values = {
      canonical_title: song.canonical_title,
      display_title: song.display_title,
      artist: song.canonical_artist
    } satisfies Record<SystemAliasType, string>;
    for (const aliasType of ADMIN_SYSTEM_ALIAS_TYPES) {
      const search = buildAliasSearchFields(values[aliasType]);
      const matching = (aliasesBySong.get(song.id) ?? []).filter(
        (alias) =>
          alias.alias_type === aliasType &&
          alias.normalized_alias === search.normalizedAlias
      );
      if (matching.length > 1) {
        blockers.push({
          code: "AMBIGUOUS_SYSTEM_ALIAS",
          song_id: song.id,
          alias_type: aliasType,
          matching_count: matching.length
        });
        continue;
      }
      if (matching.length === 1) continue;

      const id = `alias_system_${song.id}_${aliasType}`;
      if (conflictingIds.has(id)) {
        blockers.push({
          code: "CANDIDATE_ID_CONFLICT",
          song_id: song.id,
          alias_type: aliasType,
          alias_id: id
        });
        continue;
      }
      candidates.push({
        id,
        songId: song.id,
        alias: values[aliasType],
        language: song.original_language,
        aliasType,
        normalizedAlias: search.normalizedAlias,
        chosungAlias: search.chosungAlias || null,
        sourceUrl: song.source_url,
        sourceName: song.source_name,
        verifiedBy: song.verified_by,
        verificationNote: song.verification_note
      });
    }
  }
  for (const songIds of identityGroups.values()) {
    if (songIds.length > 1) {
      blockers.push({ code: "EXACT_DUPLICATE", song_ids: songIds });
    }
  }
  return {
    plan: {
      song_count: songs.length,
      create_count: candidates.length,
      creates: candidates.map((candidate) => ({
        id: candidate.id,
        song_id: candidate.songId,
        alias_type: candidate.aliasType
      })),
      blockers
    },
    candidates
  };
}

function assertRepairable(
  plan: SystemAliasRepairPlan,
  expectedCreateCount: number | undefined
): void {
  if (plan.blockers.length > 0) {
    throw new Error("System alias repair is blocked by catalog invariants.");
  }
  if (
    expectedCreateCount !== undefined &&
    plan.create_count !== expectedCreateCount
  ) {
    throw new Error(
      `System alias repair expected ${expectedCreateCount} creates but found ${plan.create_count}.`
    );
  }
}
