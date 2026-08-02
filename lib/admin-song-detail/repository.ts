import { randomUUID } from "node:crypto";

import { Prisma, type PrismaClient } from "../generated/prisma/client";
import { validateAdminKaraokeEntryPolicy } from "../admin-song/entry-policy";
import { ADMIN_SYSTEM_ALIAS_TYPES } from "../admin-song/types";
import { adminSongValidationError } from "../admin-song/validation";
import {
  DuplicateCheckRepositoryError,
  findDuplicateCandidates,
  findDuplicateCandidatesInTransaction,
  isStatementTimeout
} from "../admin-song-duplicate/repository";
import type { CandidateSummary } from "../admin-song-duplicate/types";
import { buildAliasSearchFields } from "../search/normalize";
import { normalizeSongIdentity } from "../song-identity/normalize";
import { isNormalizedIdentityUniqueViolation } from "../song-identity/prisma-error";
import {
  ADMIN_SONG_MAX_ALIASES,
  ADMIN_SONG_MAX_ENTRIES,
  type AdminSongDetail,
  type AdminSongPatchInput,
  type AdminSongPatchResult,
  type AdminSongUpdateCounts
} from "./types";

const DETAIL_SELECT = {
  id: true,
  originalLanguage: true,
  canonicalTitle: true,
  displayTitle: true,
  canonicalArtist: true,
  releaseYear: true,
  tieIn: true,
  sourceName: true,
  sourceUrl: true,
  verificationNote: true,
  updatedAt: true,
  aliases: {
    orderBy: [{ aliasType: "asc" }, { id: "asc" }],
    select: {
      id: true,
      alias: true,
      language: true,
      aliasType: true,
      normalizedAlias: true,
      sourceName: true,
      sourceUrl: true,
      verificationNote: true,
      updatedAt: true
    }
  },
  karaokeEntries: {
    orderBy: [
      { providerId: "asc" },
      { versionInfo: "asc" },
      { karaokeNumber: "asc" },
      { id: "asc" }
    ],
    select: {
      id: true,
      providerId: true,
      karaokeNumber: true,
      versionInfo: true,
      availabilityStatus: true,
      lastVerifiedAt: true,
      sourceName: true,
      sourceUrl: true,
      verificationNote: true,
      updatedAt: true,
      provider: {
        select: { name: true, country: true }
      }
    }
  }
} as const satisfies Prisma.SongSelect;

type DetailRecord = Prisma.SongGetPayload<{ select: typeof DETAIL_SELECT }>;
type Transaction = Prisma.TransactionClient;

export type AdminSongDetailRepositoryErrorCode =
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "STALE"
  | "DUPLICATE_SONG"
  | "POSSIBLE_DUPLICATE_CONFIRMATION_REQUIRED"
  | "PROVIDER_NOT_FOUND"
  | "DUPLICATE_CHECK_TIMEOUT"
  | "SYSTEM_ALIAS_INVARIANT"
  | "CONFLICT"
  | "TIMEOUT";

export class AdminSongDetailRepositoryError extends Error {
  constructor(
    readonly code: AdminSongDetailRepositoryErrorCode,
    readonly candidates: readonly CandidateSummary[] = []
  ) {
    super(code);
    this.name = "AdminSongDetailRepositoryError";
  }
}

export type AdminSongDetailRepository = Readonly<{
  get(userId: string, songId: string): Promise<AdminSongDetail>;
  update(
    userId: string,
    songId: string,
    input: AdminSongPatchInput
  ): Promise<AdminSongPatchResult>;
}>;

export function createPrismaAdminSongDetailRepository(
  db: PrismaClient,
  options: Readonly<{
    generateId?: () => string;
    now?: () => Date;
  }> = {}
): AdminSongDetailRepository {
  const generateId = options.generateId ?? randomUUID;
  const now = options.now ?? (() => new Date());

  return {
    async get(userId, songId) {
      await requireAdmin(db, userId);
      const song = await readDetailRecord(db, songId);
      if (song === null) {
        throw new AdminSongDetailRepositoryError("NOT_FOUND");
      }
      assertSystemAliasInvariant(song);
      return toDetail(song);
    },

    async update(userId, songId, input) {
      const duplicateInput = {
        canonical_title: input.song.canonical_title,
        display_title: input.song.display_title,
        canonical_artist: input.song.canonical_artist,
        exclude_song_id: songId
      };
      try {
        return await db.$transaction(
          async (transaction) => {
            await requireAdmin(transaction, userId);
            const current = await readDetailRecord(transaction, songId);
            if (current === null) {
              throw new AdminSongDetailRepositoryError("NOT_FOUND");
            }
            assertSystemAliasInvariant(current);
            if (
              new Date(current.updatedAt).toISOString() !==
              new Date(input.expected_updated_at).toISOString()
            ) {
              throw new AdminSongDetailRepositoryError("STALE");
            }

            validateAggregate(current, input, now());
            const identityChanged = hasIdentityChanged(current, input);
            if (identityChanged) {
              let duplicate;
              try {
                duplicate = await findDuplicateCandidatesInTransaction(
                  transaction,
                  duplicateInput
                );
              } catch (error) {
                if (isStatementTimeout(error)) {
                  throw new AdminSongDetailRepositoryError(
                    "DUPLICATE_CHECK_TIMEOUT"
                  );
                }
                throw error;
              }
              if (duplicate.classification === "exact") {
                throw new AdminSongDetailRepositoryError(
                  "DUPLICATE_SONG",
                  duplicate.candidates
                );
              }
              if (
                duplicate.classification === "possible" &&
                !sameIdSet(
                  duplicate.candidates.map((candidate) => candidate.id),
                  input.possible_duplicate_acknowledged_song_ids
                )
              ) {
                throw new AdminSongDetailRepositoryError(
                  "POSSIBLE_DUPLICATE_CONFIRMATION_REQUIRED",
                  duplicate.candidates
                );
              }
            }

            const providerIds = [
              ...new Set(
                input.karaoke_entries.map((entry) => entry.provider_id)
              )
            ];
            const providers = await transaction.karaokeProvider.findMany({
              where: { id: { in: providerIds }, isActive: true },
              select: { id: true }
            });
            if (providers.length !== providerIds.length) {
              throw new AdminSongDetailRepositoryError("PROVIDER_NOT_FOUND");
            }

            const changeCounts = calculateChangeCounts(current, input);
            const verifiedBy = `admin:${userId}`;
            await applyAliases(
              transaction,
              current,
              input,
              verifiedBy,
              generateId
            );
            await applyEntries(
              transaction,
              current,
              input,
              verifiedBy,
              generateId
            );
            await syncSystemAliases(transaction, current, input, verifiedBy);
            const identity = normalizeSongIdentity(input.song);
            await transaction.song.update({
              where: { id: songId },
              data: {
                originalLanguage: input.song.original_language,
                canonicalTitle: input.song.canonical_title,
                displayTitle: input.song.display_title,
                canonicalArtist: input.song.canonical_artist,
                normalizedCanonicalTitle: identity.normalizedCanonicalTitle,
                normalizedCanonicalArtist: identity.normalizedCanonicalArtist,
                releaseYear: input.song.release_year,
                tieIn: input.song.tie_in,
                ...(Object.hasOwn(input.song, "source_name")
                  ? { sourceName: input.song.source_name }
                  : {}),
                ...(Object.hasOwn(input.song, "source_url")
                  ? { sourceUrl: input.song.source_url }
                  : {}),
                ...(Object.hasOwn(input.song, "verification_note")
                  ? { verificationNote: input.song.verification_note }
                  : {}),
                verifiedBy
              }
            });
            const updated = await readDetailRecord(transaction, songId);
            if (updated === null) {
              throw new AdminSongDetailRepositoryError("NOT_FOUND");
            }
            return {
              detail: toDetail(updated),
              change_counts: changeCounts
            };
          },
          { isolationLevel: "Serializable" }
        );
      } catch (error) {
        if (error instanceof AdminSongDetailRepositoryError) throw error;
        if (isStatementTimeout(error)) {
          throw new AdminSongDetailRepositoryError("TIMEOUT");
        }
        if (isNormalizedIdentityUniqueViolation(error)) {
          try {
            const duplicate = await findDuplicateCandidates(db, duplicateInput);
            throw new AdminSongDetailRepositoryError(
              "DUPLICATE_SONG",
              duplicate.candidates
            );
          } catch (candidateError) {
            if (candidateError instanceof AdminSongDetailRepositoryError) {
              throw candidateError;
            }
            if (candidateError instanceof DuplicateCheckRepositoryError) {
              throw new AdminSongDetailRepositoryError(
                "DUPLICATE_CHECK_TIMEOUT"
              );
            }
            throw candidateError;
          }
        }
        if (hasPrismaCode(error, "P2034")) {
          throw new AdminSongDetailRepositoryError("STALE");
        }
        if (hasPrismaCode(error, "P2002")) {
          throw new AdminSongDetailRepositoryError("CONFLICT");
        }
        throw error;
      }
    }
  };
}

async function readDetailRecord(
  db: Pick<PrismaClient, "song">,
  songId: string
): Promise<DetailRecord | null> {
  return db.song.findUnique({
    where: { id: songId },
    select: DETAIL_SELECT
  });
}

function toDetail(song: DetailRecord): AdminSongDetail {
  const systemTypes = new Set<string>(ADMIN_SYSTEM_ALIAS_TYPES);
  const systemAliases = correspondingSystemAliases(song);
  const systemIds = new Set(systemAliases.map((alias) => alias.id));
  return {
    song: {
      id: song.id,
      original_language: song.originalLanguage,
      canonical_title: song.canonicalTitle,
      display_title: song.displayTitle,
      canonical_artist: song.canonicalArtist,
      release_year: song.releaseYear,
      tie_in: song.tieIn,
      source_name: song.sourceName,
      source_url: song.sourceUrl,
      verification_note: song.verificationNote,
      updated_at: new Date(song.updatedAt).toISOString()
    },
    system_aliases: systemAliases.map((alias) => ({
      id: alias.id,
      alias: alias.alias,
      language: alias.language,
      alias_type: alias.aliasType as
        "canonical_title" | "display_title" | "artist",
      updated_at: new Date(alias.updatedAt).toISOString()
    })),
    aliases: song.aliases
      .filter(
        (alias) => !systemIds.has(alias.id) && !systemTypes.has(alias.aliasType)
      )
      .map((alias) => ({
        id: alias.id,
        alias: alias.alias,
        language: alias.language,
        alias_type:
          alias.aliasType as AdminSongDetail["aliases"][number]["alias_type"],
        source_name: alias.sourceName,
        source_url: alias.sourceUrl,
        verification_note: alias.verificationNote,
        updated_at: new Date(alias.updatedAt).toISOString()
      })),
    karaoke_entries: song.karaokeEntries.map((entry) => ({
      id: entry.id,
      provider_id: entry.providerId,
      provider_name: entry.provider.name,
      provider_country: entry.provider.country,
      karaoke_number: entry.karaokeNumber,
      version_info: entry.versionInfo,
      availability_status: entry.availabilityStatus,
      last_verified_at:
        entry.lastVerifiedAt === null
          ? null
          : new Date(entry.lastVerifiedAt).toISOString().slice(0, 10),
      source_name: entry.sourceName,
      source_url: entry.sourceUrl,
      verification_note: entry.verificationNote,
      updated_at: new Date(entry.updatedAt).toISOString()
    })),
    limits: {
      aliases: ADMIN_SONG_MAX_ALIASES,
      karaoke_entries: ADMIN_SONG_MAX_ENTRIES
    }
  };
}

function assertSystemAliasInvariant(song: DetailRecord): void {
  const corresponding = correspondingSystemAliases(song);
  for (const aliasType of ADMIN_SYSTEM_ALIAS_TYPES) {
    if (
      corresponding.filter((alias) => alias.aliasType === aliasType).length !==
      1
    ) {
      throw new AdminSongDetailRepositoryError("SYSTEM_ALIAS_INVARIANT");
    }
  }
}

function correspondingSystemAliases(song: DetailRecord) {
  const normalizedValues = {
    canonical_title: buildAliasSearchFields(song.canonicalTitle)
      .normalizedAlias,
    display_title: buildAliasSearchFields(song.displayTitle).normalizedAlias,
    artist: buildAliasSearchFields(song.canonicalArtist).normalizedAlias
  };
  return song.aliases.filter(
    (alias) =>
      (ADMIN_SYSTEM_ALIAS_TYPES as readonly string[]).includes(
        alias.aliasType
      ) &&
      alias.normalizedAlias ===
        normalizedValues[alias.aliasType as keyof typeof normalizedValues]
  );
}

function validateAggregate(
  current: DetailRecord,
  input: AdminSongPatchInput,
  currentDate: Date
): void {
  if (input.aliases.length > ADMIN_SONG_MAX_ALIASES) {
    throw adminSongValidationError("aliases", "Too many aliases.", {
      max: ADMIN_SONG_MAX_ALIASES
    });
  }
  if (input.karaoke_entries.length > ADMIN_SONG_MAX_ENTRIES) {
    throw adminSongValidationError(
      "karaoke_entries",
      "Too many karaoke entries.",
      { max: ADMIN_SONG_MAX_ENTRIES }
    );
  }
  if (
    hasIdentityChanged(current, input) &&
    (!Object.hasOwn(input.song, "source_name") ||
      input.song.source_name === null ||
      input.song.source_name?.trim() === "")
  ) {
    throw adminSongValidationError(
      "song.source_name",
      "Source name must be reconfirmed when identity fields change."
    );
  }
  validateAliasAggregate(current, input);
  validateEntryAggregate(current, input, currentDate);
}

function validateAliasAggregate(
  current: DetailRecord,
  input: AdminSongPatchInput
): void {
  const existingAdmin = current.aliases.filter(
    (alias) =>
      !(ADMIN_SYSTEM_ALIAS_TYPES as readonly string[]).includes(alias.aliasType)
  );
  const existingIds = new Set(existingAdmin.map((alias) => alias.id));
  const suppliedIds = input.aliases
    .map((alias) => alias.id)
    .filter((id): id is string => id !== undefined);
  if (
    new Set(suppliedIds).size !== suppliedIds.length ||
    suppliedIds.some((id) => !existingIds.has(id))
  ) {
    throw adminSongValidationError(
      "aliases",
      "Alias IDs must identify editable aliases on this song."
    );
  }
  const systemValues = [
    input.song.canonical_title,
    input.song.display_title,
    input.song.canonical_artist
  ].map((value) => buildAliasSearchFields(value).normalizedAlias);
  const normalized = new Set(systemValues);
  for (const [index, alias] of input.aliases.entries()) {
    const value = buildAliasSearchFields(alias.alias).normalizedAlias;
    if (value === "" || normalized.has(value)) {
      throw adminSongValidationError(
        `aliases.${index}.alias`,
        "Alias duplicates a system or administrator alias."
      );
    }
    normalized.add(value);
  }
}

function validateEntryAggregate(
  current: DetailRecord,
  input: AdminSongPatchInput,
  currentDate: Date
): void {
  const currentById = new Map(
    current.karaokeEntries.map((entry) => [entry.id, entry])
  );
  const suppliedIds = input.karaoke_entries
    .map((entry) => entry.id)
    .filter((id): id is string => id !== undefined);
  if (
    new Set(suppliedIds).size !== suppliedIds.length ||
    suppliedIds.some((id) => !currentById.has(id)) ||
    suppliedIds.length !== current.karaokeEntries.length
  ) {
    throw adminSongValidationError(
      "karaoke_entries",
      "Existing karaoke entries cannot be deleted or replaced."
    );
  }
  const tuples = new Set<string>();
  for (const [index, entry] of input.karaoke_entries.entries()) {
    const path = `karaoke_entries.${index}`;
    const existing =
      entry.id === undefined ? undefined : currentById.get(entry.id);
    const statusChanged =
      existing !== undefined &&
      existing.availabilityStatus !== entry.availability_status;
    const finalVerifiedAt = Object.hasOwn(entry, "last_verified_at")
      ? (entry.last_verified_at ?? null)
      : storedVerifiedDate(existing?.lastVerifiedAt);
    const finalNote = Object.hasOwn(entry, "verification_note")
      ? (entry.verification_note ?? null)
      : (existing?.verificationNote ?? null);
    validateAdminKaraokeEntryPolicy({
      availabilityStatus: entry.availability_status,
      karaokeNumber: entry.karaoke_number,
      lastVerifiedAt: finalVerifiedAt,
      verificationNote: finalNote,
      currentDate,
      path,
      requireExplicitVerifiedDate: statusChanged,
      hasExplicitVerifiedDate: Object.hasOwn(entry, "last_verified_at")
    });
    if (
      (existing === undefined || statusChanged) &&
      (!Object.hasOwn(entry, "source_name") ||
        typeof entry.source_name !== "string" ||
        entry.source_name.trim() === "")
    ) {
      throw adminSongValidationError(
        `${path}.source_name`,
        "Source name must be supplied for a new or changed status."
      );
    }
    const tuple = [
      entry.provider_id,
      entry.version_info,
      entry.karaoke_number
    ].join("\u0000");
    if (tuples.has(tuple)) {
      throw adminSongValidationError(
        "karaoke_entries",
        "Duplicate provider entry."
      );
    }
    tuples.add(tuple);
  }
}

function storedVerifiedDate(
  value: DetailRecord["karaokeEntries"][number]["lastVerifiedAt"] | undefined
): string | null {
  return value === null || value === undefined
    ? null
    : new Date(value).toISOString().slice(0, 10);
}

async function applyAliases(
  transaction: Transaction,
  current: DetailRecord,
  input: AdminSongPatchInput,
  verifiedBy: string,
  generateId: () => string
): Promise<void> {
  const existing = current.aliases.filter(
    (alias) =>
      !(ADMIN_SYSTEM_ALIAS_TYPES as readonly string[]).includes(alias.aliasType)
  );
  const suppliedIds = new Set(
    input.aliases
      .map((alias) => alias.id)
      .filter((id): id is string => id !== undefined)
  );
  const deletedIds = existing
    .filter((alias) => !suppliedIds.has(alias.id))
    .map((alias) => alias.id);
  if (deletedIds.length > 0) {
    await transaction.songAlias.deleteMany({
      where: { id: { in: deletedIds }, songId: current.id }
    });
  }
  for (const alias of input.aliases) {
    const search = buildAliasSearchFields(alias.alias);
    const data = {
      alias: alias.alias,
      language: alias.language,
      aliasType: alias.alias_type,
      normalizedAlias: search.normalizedAlias,
      chosungAlias: search.chosungAlias || null,
      ...(Object.hasOwn(alias, "source_name")
        ? { sourceName: alias.source_name }
        : {}),
      ...(Object.hasOwn(alias, "source_url")
        ? { sourceUrl: alias.source_url }
        : {}),
      ...(Object.hasOwn(alias, "verification_note")
        ? { verificationNote: alias.verification_note }
        : {}),
      verifiedBy
    };
    if (alias.id === undefined) {
      await transaction.songAlias.create({
        data: {
          id: `alias_${generateId()}`,
          songId: current.id,
          ...data
        }
      });
    } else {
      await transaction.songAlias.update({
        where: { id: alias.id },
        data
      });
    }
  }
}

async function applyEntries(
  transaction: Transaction,
  current: DetailRecord,
  input: AdminSongPatchInput,
  verifiedBy: string,
  generateId: () => string
): Promise<void> {
  for (const [index, entry] of input.karaoke_entries.entries()) {
    const data = {
      providerId: entry.provider_id,
      karaokeNumber: entry.karaoke_number,
      versionInfo: entry.version_info,
      availabilityStatus: entry.availability_status,
      ...(Object.hasOwn(entry, "last_verified_at")
        ? {
            lastVerifiedAt:
              entry.last_verified_at === null
                ? null
                : new Date(`${entry.last_verified_at}T00:00:00.000Z`)
          }
        : {}),
      ...(Object.hasOwn(entry, "source_name")
        ? { sourceName: entry.source_name }
        : {}),
      ...(Object.hasOwn(entry, "source_url")
        ? { sourceUrl: entry.source_url }
        : {}),
      ...(Object.hasOwn(entry, "verification_note")
        ? { verificationNote: entry.verification_note }
        : {}),
      verifiedBy
    };
    if (entry.id === undefined) {
      const sourceName = entry.source_name;
      if (typeof sourceName !== "string" || sourceName.trim() === "") {
        throw adminSongValidationError(`karaoke_entries.${index}.source_name`);
      }
      await transaction.karaokeEntry.create({
        data: {
          id: `entry_${generateId()}`,
          songId: current.id,
          ...data,
          sourceName
        }
      });
    } else {
      await transaction.karaokeEntry.update({
        where: { id: entry.id },
        data
      });
    }
  }
}

async function syncSystemAliases(
  transaction: Transaction,
  current: DetailRecord,
  input: AdminSongPatchInput,
  verifiedBy: string
): Promise<void> {
  const values = {
    canonical_title: input.song.canonical_title,
    display_title: input.song.display_title,
    artist: input.song.canonical_artist
  };
  for (const aliasType of ADMIN_SYSTEM_ALIAS_TYPES) {
    const alias = correspondingSystemAliases(current).find(
      (candidate) => candidate.aliasType === aliasType
    );
    if (alias === undefined) {
      throw new AdminSongDetailRepositoryError("SYSTEM_ALIAS_INVARIANT");
    }
    const value = values[aliasType];
    const search = buildAliasSearchFields(value);
    await transaction.songAlias.update({
      where: { id: alias.id },
      data: {
        alias: value,
        language: input.song.original_language,
        normalizedAlias: search.normalizedAlias,
        chosungAlias: search.chosungAlias || null,
        verifiedBy
      }
    });
  }
}

function calculateChangeCounts(
  current: DetailRecord,
  input: AdminSongPatchInput
): AdminSongUpdateCounts {
  const currentAliases = new Map(
    current.aliases.map((alias) => [alias.id, alias])
  );
  const currentEntries = new Map(
    current.karaokeEntries.map((entry) => [entry.id, entry])
  );
  const inputAliasIds = new Set(
    input.aliases
      .map((alias) => alias.id)
      .filter((id): id is string => id !== undefined)
  );
  return {
    song_fields: [
      current.originalLanguage !== input.song.original_language,
      current.canonicalTitle !== input.song.canonical_title,
      current.displayTitle !== input.song.display_title,
      current.canonicalArtist !== input.song.canonical_artist,
      current.releaseYear !== input.song.release_year,
      current.tieIn !== input.song.tie_in,
      Object.hasOwn(input.song, "source_name") &&
        current.sourceName !== input.song.source_name,
      Object.hasOwn(input.song, "source_url") &&
        current.sourceUrl !== input.song.source_url,
      Object.hasOwn(input.song, "verification_note") &&
        current.verificationNote !== input.song.verification_note
    ].filter(Boolean).length,
    aliases_added: input.aliases.filter((alias) => alias.id === undefined)
      .length,
    aliases_updated: input.aliases.filter(
      (alias) =>
        alias.id !== undefined &&
        aliasChanged(currentAliases.get(alias.id), alias)
    ).length,
    aliases_deleted: current.aliases.filter(
      (alias) =>
        !(ADMIN_SYSTEM_ALIAS_TYPES as readonly string[]).includes(
          alias.aliasType
        ) && !inputAliasIds.has(alias.id)
    ).length,
    karaoke_entries_added: input.karaoke_entries.filter(
      (entry) => entry.id === undefined
    ).length,
    karaoke_entries_updated: input.karaoke_entries.filter(
      (entry) =>
        entry.id !== undefined &&
        entryChanged(currentEntries.get(entry.id), entry)
    ).length
  };
}

function aliasChanged(
  current: DetailRecord["aliases"][number] | undefined,
  input: AdminSongPatchInput["aliases"][number]
): boolean {
  if (current === undefined) return true;
  return (
    current.alias !== input.alias ||
    current.language !== input.language ||
    current.aliasType !== input.alias_type ||
    (Object.hasOwn(input, "source_name") &&
      current.sourceName !== input.source_name) ||
    (Object.hasOwn(input, "source_url") &&
      current.sourceUrl !== input.source_url) ||
    (Object.hasOwn(input, "verification_note") &&
      current.verificationNote !== input.verification_note)
  );
}

function entryChanged(
  current: DetailRecord["karaokeEntries"][number] | undefined,
  input: AdminSongPatchInput["karaoke_entries"][number]
): boolean {
  if (current === undefined) return true;
  return (
    current.providerId !== input.provider_id ||
    current.karaokeNumber !== input.karaoke_number ||
    current.versionInfo !== input.version_info ||
    current.availabilityStatus !== input.availability_status ||
    (Object.hasOwn(input, "source_name") &&
      current.sourceName !== input.source_name) ||
    (Object.hasOwn(input, "source_url") &&
      current.sourceUrl !== input.source_url) ||
    (Object.hasOwn(input, "verification_note") &&
      current.verificationNote !== input.verification_note) ||
    (Object.hasOwn(input, "last_verified_at") &&
      (current.lastVerifiedAt === null
        ? null
        : new Date(current.lastVerifiedAt).toISOString().slice(0, 10)) !==
        input.last_verified_at)
  );
}

function hasIdentityChanged(
  current: DetailRecord,
  input: AdminSongPatchInput
): boolean {
  return (
    current.originalLanguage !== input.song.original_language ||
    current.canonicalTitle !== input.song.canonical_title ||
    current.displayTitle !== input.song.display_title ||
    current.canonicalArtist !== input.song.canonical_artist
  );
}

function sameIdSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((id) => rightSet.has(id));
}

type AdminLookupDb = Pick<PrismaClient, "user">;

async function requireAdmin(db: AdminLookupDb, userId: string): Promise<void> {
  const actor = await db.user.findUnique({
    where: { id: userId },
    select: { role: true }
  });
  if (actor?.role !== "admin") {
    throw new AdminSongDetailRepositoryError("FORBIDDEN");
  }
}

function hasPrismaCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}
