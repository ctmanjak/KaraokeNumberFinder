import { personalizationError } from "../personalization";
import { normalizeSearchText } from "../search/normalize";

export const MAX_SEARCH_HISTORY_ITEMS = 10;
export const MAX_SEARCH_HISTORY_QUERY_LENGTH = 200;

export type SearchHistoryOwner = Readonly<{ userId: string }>;
export type SearchHistoryIdentity = Readonly<{
  userId: string;
  id: string;
}>;
export type SearchHistorySaveRequest = Readonly<{
  userId: string;
  query: string;
}>;
export type SearchHistoryWrite = Readonly<{
  userId: string;
  query: string;
  normalizedQuery: string;
}>;

export type SearchHistoryRecord = Readonly<{
  id: string;
  query: string;
  normalizedQuery: string;
  searchedAt: Date;
}>;

export interface SearchHistoryRepository {
  list(owner: SearchHistoryOwner, take: number): Promise<SearchHistoryRecord[]>;
  save(input: SearchHistoryWrite, keep: number): Promise<SearchHistoryRecord>;
  delete(identity: SearchHistoryIdentity): Promise<number>;
  clear(owner: SearchHistoryOwner): Promise<number>;
}

export type SearchHistoryItem = Readonly<{
  id: string;
  query: string;
  normalized_query: string;
  searched_at: string;
}>;

export interface SearchHistoryService {
  list(
    owner: SearchHistoryOwner
  ): Promise<Readonly<{ items: SearchHistoryItem[] }>>;
  save(
    input: SearchHistorySaveRequest
  ): Promise<Readonly<{ item: SearchHistoryItem }>>;
  delete(
    identity: SearchHistoryIdentity
  ): Promise<Readonly<{ deleted_count: number }>>;
  clear(
    owner: SearchHistoryOwner
  ): Promise<Readonly<{ deleted_count: number }>>;
}

export function createSearchHistoryService(
  repository: SearchHistoryRepository
): SearchHistoryService {
  return {
    async list(owner) {
      const records = await repository.list(owner, MAX_SEARCH_HISTORY_ITEMS);
      return { items: records.map(toSearchHistoryItem) };
    },

    async save(input) {
      const query = input.query.trim();
      const normalizedQuery = normalizeSearchText(query);

      if (!hasValidLength(query) || !hasValidLength(normalizedQuery)) {
        throw personalizationError("VALIDATION_ERROR");
      }

      const record = await repository.save(
        {
          userId: input.userId,
          query,
          normalizedQuery
        },
        MAX_SEARCH_HISTORY_ITEMS
      );

      return { item: toSearchHistoryItem(record) };
    },

    async delete(identity) {
      return { deleted_count: await repository.delete(identity) };
    },

    async clear(owner) {
      return { deleted_count: await repository.clear(owner) };
    }
  };
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
