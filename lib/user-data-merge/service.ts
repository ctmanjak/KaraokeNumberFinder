import { personalizationError } from "../personalization";
import { normalizeSearchText } from "../search/normalize";
import {
  MAX_SEARCH_HISTORY_ITEMS,
  MAX_SEARCH_HISTORY_QUERY_LENGTH,
  type SearchHistoryItem,
  type SearchHistoryRecord
} from "../search-history/service";
import type {
  UserPreferenceProviderRecord,
  UserPreferenceReadModel
} from "../user-preference/service";

const MAX_FUTURE_SEARCH_OFFSET_MS = 5 * 60 * 1_000;
const ISO_DATE_TIME_PATTERN =
  /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})T(?<hour>\d{2}):(?<minute>\d{2}):(?<second>\d{2})(?:\.\d{1,3})?(?<zone>Z|[+-](?<offsetHour>\d{2}):(?<offsetMinute>\d{2}))$/u;

export type UserDataMergeRecentSearchInput = Readonly<{
  query: string;
  searchedAt: string;
}>;

export type UserDataMergeInput = Readonly<{
  userId: string;
  mergeId: string;
  recentSearches: readonly UserDataMergeRecentSearchInput[];
  defaultProviderId?: string;
}>;

export type UserDataMergeRecentSearchWrite = Readonly<{
  query: string;
  normalizedQuery: string;
  searchedAt: Date;
}>;

export type UserDataMergeWrite = Readonly<{
  userId: string;
  mergeId: string;
  recentSearches: readonly UserDataMergeRecentSearchWrite[];
  defaultProviderId?: string;
}>;

export type UserDataMergeRecord = Readonly<{
  recentSearches: readonly SearchHistoryRecord[];
  defaultProvider: Readonly<{
    provider: UserPreferenceProviderRecord | null;
    source: "user" | "operational_default" | "none";
  }>;
}>;

export interface UserDataMergeRepository {
  merge(input: UserDataMergeWrite, keep: number): Promise<UserDataMergeRecord>;
}

export type UserDataMergeResponse = Readonly<{
  merged: true;
  recent_searches: SearchHistoryItem[];
  default_provider: UserPreferenceReadModel;
}>;

export interface UserDataMergeService {
  merge(input: UserDataMergeInput): Promise<UserDataMergeResponse>;
}

export function createUserDataMergeService(
  repository: UserDataMergeRepository,
  options: { now?: () => Date } = {}
): UserDataMergeService {
  return {
    async merge(input) {
      const now = options.now?.() ?? new Date();
      const recentSearches = prepareRecentSearches(input.recentSearches, now);
      const record = await repository.merge(
        {
          userId: input.userId,
          mergeId: input.mergeId,
          recentSearches,
          ...(input.defaultProviderId === undefined
            ? {}
            : { defaultProviderId: input.defaultProviderId })
        },
        MAX_SEARCH_HISTORY_ITEMS
      );

      return {
        merged: true,
        recent_searches: record.recentSearches.map(toSearchHistoryItem),
        default_provider: toDefaultProvider(record.defaultProvider)
      };
    }
  };
}

function prepareRecentSearches(
  input: readonly UserDataMergeRecentSearchInput[],
  now: Date
): UserDataMergeRecentSearchWrite[] {
  if (input.length > MAX_SEARCH_HISTORY_ITEMS) {
    throw personalizationError("VALIDATION_ERROR");
  }

  const byNormalizedQuery = new Map<string, UserDataMergeRecentSearchWrite>();

  for (const item of input) {
    const query = item.query.trim();
    const normalizedQuery = normalizeSearchText(query);
    const searchedAt = parseSearchedAt(item.searchedAt);

    if (
      !hasValidLength(query) ||
      !hasValidLength(normalizedQuery) ||
      searchedAt === null
    ) {
      throw personalizationError("VALIDATION_ERROR");
    }

    const clampedSearchedAt =
      searchedAt.getTime() > now.getTime() + MAX_FUTURE_SEARCH_OFFSET_MS
        ? new Date(now)
        : searchedAt;
    const existing = byNormalizedQuery.get(normalizedQuery);

    if (
      existing === undefined ||
      clampedSearchedAt.getTime() > existing.searchedAt.getTime()
    ) {
      byNormalizedQuery.set(normalizedQuery, {
        query,
        normalizedQuery,
        searchedAt: clampedSearchedAt
      });
    }
  }

  return [...byNormalizedQuery.values()].sort(
    (left, right) => right.searchedAt.getTime() - left.searchedAt.getTime()
  );
}

function parseSearchedAt(value: string): Date | null {
  const match = ISO_DATE_TIME_PATTERN.exec(value);
  const groups = match?.groups;
  if (groups === undefined) {
    return null;
  }

  const year = Number(groups.year);
  const month = Number(groups.month);
  const day = Number(groups.day);
  const hour = Number(groups.hour);
  const minute = Number(groups.minute);
  const second = Number(groups.second);
  const offsetHour = Number(groups.offsetHour ?? 0);
  const offsetMinute = Number(groups.offsetMinute ?? 0);

  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth(year, month) ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHour > 23 ||
    offsetMinute > 59
  ) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const isLeapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return isLeapYear ? 29 : 28;
  }

  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

function hasValidLength(value: string): boolean {
  const length = Array.from(value).length;
  return length > 0 && length <= MAX_SEARCH_HISTORY_QUERY_LENGTH;
}

function toSearchHistoryItem(record: SearchHistoryRecord): SearchHistoryItem {
  return {
    id: record.id,
    query: record.query,
    normalized_query: record.normalizedQuery,
    searched_at: record.searchedAt.toISOString()
  };
}

function toDefaultProvider(
  record: UserDataMergeRecord["defaultProvider"]
): UserPreferenceReadModel {
  if (record.provider === null) {
    return { default_provider: null, source: "none" };
  }

  return {
    default_provider: {
      id: record.provider.id,
      name: record.provider.name,
      country: record.provider.country,
      is_active: true,
      display_order: record.provider.displayOrder,
      is_default: record.provider.isDefault,
      last_catalog_updated_at: formatNullableDate(
        record.provider.lastCatalogUpdatedAt
      )
    },
    source: record.source
  };
}

function formatNullableDate(value: Date | string | null): string | null {
  if (value === null) {
    return null;
  }

  return value instanceof Date ? value.toISOString().slice(0, 10) : value;
}
