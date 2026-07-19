import { personalizationDomainError } from "../personalization";
import {
  decodeFavoriteCursor,
  encodeFavoriteCursor,
  type FavoriteCursor
} from "./cursor";

export const DEFAULT_FAVORITE_LIMIT = 20;
export const MAX_FAVORITE_LIMIT = 50;
const STALE_VERIFICATION_DAYS = 180;

export type FavoriteOwner = Readonly<{ userId: string }>;
export type FavoriteIdentity = Readonly<{
  userId: string;
  songId: string;
}>;

export type FavoriteProviderRecord = Readonly<{
  id: string;
  name: string;
  country: string;
  isActive: boolean;
  displayOrder: number;
  isDefault: boolean;
  lastCatalogUpdatedAt: Date | string | null;
}>;

export type FavoriteKaraokeEntryRecord = Readonly<{
  id: string;
  providerId: string;
  karaokeNumber: string;
  versionInfo: string;
  availabilityStatus: string;
  lastVerifiedAt: Date | string | null;
  provider: FavoriteProviderRecord;
}>;

export type FavoriteSongRecord = Readonly<{
  id: string;
  originalLanguage: string;
  canonicalTitle: string;
  displayTitle: string;
  canonicalArtist: string;
  releaseYear: number | null;
  tieIn: string | null;
  karaokeEntries: readonly FavoriteKaraokeEntryRecord[];
}>;

export type FavoriteListRecord = Readonly<{
  id: string;
  songId: string;
  createdAt: Date;
  song: FavoriteSongRecord;
}>;

export type FavoriteCreatedRecord = Readonly<{
  createdAt: Date;
}>;

export type FavoriteAddResult =
  | Readonly<{ status: "ok"; favorite: FavoriteCreatedRecord }>
  | Readonly<{ status: "song_not_found" }>;

export interface FavoriteRepository {
  listPage(input: {
    owner: FavoriteOwner;
    cursor?: FavoriteCursor;
    take: number;
  }): Promise<FavoriteListRecord[]>;
  add(identity: FavoriteIdentity): Promise<FavoriteAddResult>;
  delete(identity: FavoriteIdentity): Promise<void>;
}

export type FavoriteListQuery = Readonly<{
  cursor?: string;
  limit: number;
}>;

export type FavoriteProvider = Readonly<{
  id: string;
  name: string;
  country: string;
  is_active: boolean;
  display_order: number;
  is_default: boolean;
  last_catalog_updated_at: string | null;
}>;

export type FavoriteKaraokeEntry = Readonly<{
  id: string;
  provider_id: string;
  karaoke_number: string;
  version_info: string;
  availability_status: string;
  last_verified_at: string | null;
  is_stale: boolean;
  provider: FavoriteProvider;
}>;

export type FavoriteSong = Readonly<{
  id: string;
  original_language: string;
  canonical_title: string;
  display_title: string;
  canonical_artist: string;
  release_year: number | null;
  tie_in: string | null;
  karaoke_entries: FavoriteKaraokeEntry[];
  distinguishing_labels: string[];
}>;

export type FavoriteListItem = Readonly<{
  song_id: string;
  created_at: string;
  song: FavoriteSong;
}>;

export type FavoriteListResponse = Readonly<{
  items: FavoriteListItem[];
  next_cursor: string | null;
}>;

export interface FavoriteService {
  list(
    owner: FavoriteOwner,
    query: FavoriteListQuery
  ): Promise<FavoriteListResponse>;
  add(
    identity: FavoriteIdentity
  ): Promise<Readonly<{ favorite: true; created_at: string }>>;
  delete(identity: FavoriteIdentity): Promise<Readonly<{ favorite: false }>>;
}

export function createFavoriteService(
  repository: FavoriteRepository,
  options: { now?: () => Date } = {}
): FavoriteService {
  return {
    async list(owner, query) {
      const cursor =
        query.cursor === undefined
          ? undefined
          : decodeFavoriteCursor(query.cursor);
      const records = await repository.listPage({
        owner,
        ...(cursor === undefined ? {} : { cursor }),
        take: query.limit + 1
      });
      const hasNextPage = records.length > query.limit;
      const page = records.slice(0, query.limit);
      const now = options.now?.() ?? new Date();
      const last = page.at(-1);

      return {
        items: page.map((record) => toFavoriteListItem(record, now)),
        next_cursor:
          hasNextPage && last !== undefined
            ? encodeFavoriteCursor({ id: last.id })
            : null
      };
    },

    async add(identity) {
      const result = await repository.add(identity);
      if (result.status === "song_not_found") {
        throw songNotFoundError();
      }

      return {
        favorite: true,
        created_at: result.favorite.createdAt.toISOString()
      };
    },

    async delete(identity) {
      await repository.delete(identity);
      return { favorite: false };
    }
  };
}

function songNotFoundError() {
  return personalizationDomainError({
    code: "SONG_NOT_FOUND",
    status: 404,
    publicMessage: "Song was not found."
  });
}

function toFavoriteListItem(
  record: FavoriteListRecord,
  now: Date
): FavoriteListItem {
  return {
    song_id: record.songId,
    created_at: record.createdAt.toISOString(),
    song: {
      id: record.song.id,
      original_language: record.song.originalLanguage,
      canonical_title: record.song.canonicalTitle,
      display_title: record.song.displayTitle,
      canonical_artist: record.song.canonicalArtist,
      release_year: record.song.releaseYear,
      tie_in: record.song.tieIn,
      karaoke_entries: record.song.karaokeEntries.map((entry) => ({
        id: entry.id,
        provider_id: entry.providerId,
        karaoke_number: entry.karaokeNumber,
        version_info: entry.versionInfo,
        availability_status: entry.availabilityStatus,
        last_verified_at: formatNullableDate(entry.lastVerifiedAt),
        is_stale: isStaleVerification(entry.lastVerifiedAt, now),
        provider: {
          id: entry.provider.id,
          name: entry.provider.name,
          country: entry.provider.country,
          is_active: entry.provider.isActive,
          display_order: entry.provider.displayOrder,
          is_default: entry.provider.isDefault,
          last_catalog_updated_at: formatNullableDate(
            entry.provider.lastCatalogUpdatedAt
          )
        }
      })),
      distinguishing_labels: buildDistinguishingLabels(record.song)
    }
  };
}

function buildDistinguishingLabels(song: FavoriteSongRecord): string[] {
  return [song.canonicalArtist, song.tieIn, song.releaseYear?.toString()]
    .filter((value): value is string => value !== null && value !== undefined)
    .filter((value, index, values) => values.indexOf(value) === index);
}

function isStaleVerification(value: Date | string | null, now: Date): boolean {
  const date = parseNullableDate(value);
  if (date === null) {
    return false;
  }

  const days = Math.floor(
    (startOfUtcDay(now).getTime() - startOfUtcDay(date).getTime()) /
      (24 * 60 * 60 * 1_000)
  );

  return days > STALE_VERIFICATION_DAYS;
}

function formatNullableDate(value: Date | string | null): string | null {
  return parseNullableDate(value)?.toISOString().slice(0, 10) ?? null;
}

function parseNullableDate(value: Date | string | null): Date | null {
  if (value === null) {
    return null;
  }

  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function startOfUtcDay(value: Date): Date {
  return new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate())
  );
}
