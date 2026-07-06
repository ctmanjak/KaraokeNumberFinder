import {
  canUseHangulChosungSearch,
  normalizeChosungQuery,
  normalizeSearchText
} from "./normalize";
import { measureAsync, measureSync, type SearchTimingRecorder } from "./timing";

export const DEFAULT_SEARCH_LIMIT = 20;
export const MAX_SEARCH_LIMIT = 50;
export const STALE_VERIFICATION_DAYS = 180;
// Best-effort process-local cache for active provider metadata. Provider state
// changes can be stale for up to this TTL, and serverless instances do not share it.
export const ACTIVE_PROVIDER_CACHE_TTL_MS = 30_000;

export type SearchQuery = {
  query: string;
  normalizedQuery: string;
  chosungQuery: string;
  limit: number;
  providerId?: string;
};

export type SearchQueryErrorCode = "INVALID_QUERY" | "INVALID_PROVIDER";

export type SearchQueryParseResult =
  | { ok: true; query: SearchQuery }
  | { ok: false; code: SearchQueryErrorCode; message: string };

export type SearchResponse = {
  query: string;
  normalized_query: string;
  items: SearchResultItem[];
  next_cursor: null;
  suggestions: string[];
};

export type SearchResultItem = {
  song: {
    id: string;
    original_language: string;
    canonical_title: string;
    display_title: string;
    canonical_artist: string;
    release_year: number | null;
    tie_in: string | null;
    matched_aliases: SearchMatchedAlias[];
  };
  karaoke_entries: SearchKaraokeEntry[];
  distinguishing_labels: string[];
  relevance_score: number;
};

export type SearchMatchedAlias = {
  id: string;
  alias: string;
  language: string;
  alias_type: string;
};

export type SearchKaraokeEntry = {
  id: string;
  provider_id: string;
  karaoke_number: string;
  version_info: string;
  availability_status: string;
  last_verified_at: string | null;
  is_stale: boolean;
};

type ProviderRecord = {
  id: string;
  isActive: boolean;
  isDefault: boolean;
};

type ActiveProviderCacheEntry = {
  expiresAtMs: number;
  providers?: ProviderRecord[];
  pending?: Promise<ProviderRecord[]>;
};

type AliasRecord = {
  id: string;
  songId: string;
  alias: string;
  language: string;
  aliasType: string;
  normalizedAlias: string;
  chosungAlias: string | null;
  song: SongRecord;
};

type SongRecord = {
  id: string;
  originalLanguage: string;
  canonicalTitle: string;
  displayTitle: string;
  canonicalArtist: string;
  releaseYear: number | null;
  tieIn: string | null;
  karaokeEntries: KaraokeEntryRecord[];
};

type AliasSummaryRecord = {
  id: string;
  alias: string;
  language: string;
  aliasType: string;
  normalizedAlias: string;
  chosungAlias: string | null;
};

type KaraokeEntryRecord = {
  id: string;
  providerId: string;
  karaokeNumber: string;
  versionInfo: string;
  availabilityStatus: string;
  lastVerifiedAt: Date | string | null;
};

type AliasIdRecord = {
  id: string;
};

type AliasSuggestionRecord = {
  id: string;
  alias: string;
  normalizedAlias: string;
};

export type SearchAliasCondition =
  | { normalizedAlias: { equals: string; mode: "insensitive" } }
  | { normalizedAlias: { startsWith: string; mode: "insensitive" } }
  | { normalizedAlias: { contains: string; mode: "insensitive" } }
  | { chosungAlias: { startsWith: string; mode: "insensitive" } };

type SearchAliasWhere = SearchAliasCondition | { OR: SearchAliasCondition[] };
type SearchAliasIdWhere = SearchAliasWhere | { id: { in: string[] } };
type SearchAliasSelect =
  | { id: true }
  | { id: true; alias: true; normalizedAlias: true }
  | {
      id: true;
      songId: true;
      alias: true;
      language: true;
      aliasType: true;
      normalizedAlias: true;
      chosungAlias: true;
      song: {
        select: {
          id: true;
          originalLanguage: true;
          canonicalTitle: true;
          displayTitle: true;
          canonicalArtist: true;
          releaseYear: true;
          tieIn: true;
          karaokeEntries: {
            select: {
              id: true;
              providerId: true;
              karaokeNumber: true;
              versionInfo: true;
              availabilityStatus: true;
              lastVerifiedAt: true;
            };
            orderBy: Array<
              | { providerId: "asc" }
              | { availabilityStatus: "asc" }
              | { versionInfo: "asc" }
              | { karaokeNumber: "asc" }
              | { id: "asc" }
            >;
          };
        };
      };
    };
type SearchAliasOrderBy = Array<
  | { normalizedAlias: "asc" }
  | { songId: "asc" }
  | { alias: "asc" }
  | { id: "asc" }
>;

export type SearchDbClient = {
  karaokeProvider: {
    findMany(args: {
      where: { isActive: true };
      select: { id: true; isActive: true; isDefault: true };
      orderBy: Array<{ displayOrder: "asc" } | { name: "asc" } | { id: "asc" }>;
    }): Promise<ProviderRecord[]>;
  };
  songAlias: {
    findMany(args: {
      where: SearchAliasIdWhere;
      select: SearchAliasSelect;
      orderBy: SearchAliasOrderBy;
      take?: number;
    }): Promise<Array<AliasIdRecord | AliasSuggestionRecord | AliasRecord>>;
  };
};

type RankedSong = {
  song: SongRecord;
  matchedAliases: AliasSummaryRecord[];
  bestMatchRank: number;
  bestScore: number;
};

const MIN_EXACT_CANDIDATE_TAKE = 50;
const MIN_PREFIX_CANDIDATE_TAKE = 100;
const MIN_CHOSUNG_CANDIDATE_TAKE = 100;
const MIN_PARTIAL_CANDIDATE_TAKE = 200;
const MAX_PARTIAL_CANDIDATE_TAKE = 500;
const SUGGESTION_CANDIDATE_TAKE = 25;
const AVAILABLE_STATUS = "available";
const activeProviderCache = new WeakMap<
  SearchDbClient,
  ActiveProviderCacheEntry
>();

export function parseSearchQuery(
  searchParams: URLSearchParams
): SearchQueryParseResult {
  const queryValue = searchParams.get("q");
  const compactQuery = queryValue?.replace(/\s+/gu, "") ?? "";

  if (queryValue === null || compactQuery.length === 0) {
    return {
      ok: false,
      code: "INVALID_QUERY",
      message: "q must contain at least one non-whitespace character."
    };
  }

  const limitValue = searchParams.get("limit");
  const parsedLimit = parseLimit(limitValue);

  if (parsedLimit === null) {
    return {
      ok: false,
      code: "INVALID_QUERY",
      message: `limit must be an integer between 1 and ${MAX_SEARCH_LIMIT}.`
    };
  }

  const providerId = searchParams.get("provider_id");
  const normalizedQuery = normalizeSearchText(queryValue);

  if (normalizedQuery.length === 0) {
    return {
      ok: false,
      code: "INVALID_QUERY",
      message: "q must contain searchable characters."
    };
  }

  return {
    ok: true,
    query: {
      query: queryValue,
      normalizedQuery,
      chosungQuery: normalizeChosungQuery(queryValue),
      limit: parsedLimit,
      ...(providerId === null || providerId.trim() === ""
        ? {}
        : { providerId: providerId.trim() })
    }
  };
}

export async function searchSongs(
  db: SearchDbClient,
  query: SearchQuery,
  options: { now?: Date; timing?: SearchTimingRecorder } = {}
): Promise<SearchResponse> {
  const now = options.now ?? new Date();
  const activeProviders = await measureAsync(
    options.timing,
    "search.providers",
    () => getActiveProviders(db)
  );
  const activeProviderIds = new Set(
    activeProviders.map((provider) => provider.id)
  );

  if (
    query.providerId !== undefined &&
    !activeProviderIds.has(query.providerId)
  ) {
    throw new InvalidProviderError(query.providerId);
  }

  const defaultProvider = activeProviders.find(
    (provider) => provider.isDefault
  );
  const conditions = buildSearchAliasConditions(query);

  if (conditions.length === 0) {
    return emptySearchResponse(query);
  }

  const aliases = await measureAsync(
    options.timing,
    "search.candidates.total",
    () => findTieredAliasCandidates(db, conditions, query.limit, options.timing)
  );

  const rankedSongs = measureSync(options.timing, "search.rank", () =>
    rankSongs(aliases, query, {
      providerId: query.providerId,
      defaultProviderId: defaultProvider?.id,
      now
    })
  );
  const items = measureSync(options.timing, "search.to_response_items", () =>
    rankedSongs.slice(0, query.limit).map((ranked) =>
      toSearchResultItem(ranked, {
        now
      })
    )
  );

  return {
    query: query.query,
    normalized_query: query.normalizedQuery,
    items,
    next_cursor: null,
    suggestions:
      items.length === 0
        ? await findSearchSuggestions(db, query, options.timing)
        : []
  };
}

export class InvalidProviderError extends Error {
  constructor(readonly providerId: string) {
    super(`Invalid provider_id: ${providerId}`);
    this.name = "InvalidProviderError";
  }
}

export function clearActiveProviderCache(db: SearchDbClient): void {
  activeProviderCache.delete(db);
}

async function getActiveProviders(
  db: SearchDbClient
): Promise<ProviderRecord[]> {
  const nowMs = Date.now();
  const cached = activeProviderCache.get(db);

  if (cached !== undefined) {
    if (cached.providers !== undefined && cached.expiresAtMs > nowMs) {
      return cached.providers;
    }

    if (cached.pending !== undefined) {
      return cached.pending;
    }
  }

  const pending = fetchActiveProviders(db);
  activeProviderCache.set(db, {
    expiresAtMs: nowMs + ACTIVE_PROVIDER_CACHE_TTL_MS,
    pending
  });

  try {
    const providers = await pending;
    activeProviderCache.set(db, {
      expiresAtMs: Date.now() + ACTIVE_PROVIDER_CACHE_TTL_MS,
      providers
    });

    return providers;
  } catch (error) {
    activeProviderCache.delete(db);
    throw error;
  }
}

function fetchActiveProviders(db: SearchDbClient): Promise<ProviderRecord[]> {
  return db.karaokeProvider.findMany({
    where: { isActive: true },
    select: { id: true, isActive: true, isDefault: true },
    orderBy: [{ displayOrder: "asc" }, { name: "asc" }, { id: "asc" }]
  });
}

function parseLimit(value: string | null): number | null {
  if (value === null) {
    return DEFAULT_SEARCH_LIMIT;
  }

  if (!/^\d+$/u.test(value)) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);

  if (parsed < 1 || parsed > MAX_SEARCH_LIMIT) {
    return null;
  }

  return parsed;
}

function buildSearchAliasConditions(
  query: SearchQuery
): SearchAliasCondition[] {
  const conditions: SearchAliasCondition[] = [
    { normalizedAlias: { equals: query.normalizedQuery, mode: "insensitive" } },
    {
      normalizedAlias: {
        startsWith: query.normalizedQuery,
        mode: "insensitive"
      }
    },
    {
      normalizedAlias: { contains: query.normalizedQuery, mode: "insensitive" }
    }
  ];

  if (canUseHangulChosungSearch(query.chosungQuery)) {
    conditions.push({
      chosungAlias: { startsWith: query.chosungQuery, mode: "insensitive" }
    });
  }

  return conditions;
}

async function findTieredAliasCandidates(
  db: SearchDbClient,
  conditions: SearchAliasCondition[],
  limit: number,
  timing: SearchTimingRecorder | undefined
): Promise<AliasRecord[]> {
  const exactCondition = conditions.find(isNormalizedEqualsCondition);
  const prefixCondition = conditions.find(isNormalizedStartsWithCondition);
  const chosungCondition = conditions.find(isChosungStartsWithCondition);
  const containsCondition = conditions.find(isNormalizedContainsCondition);
  const candidateIdGroups: AliasIdRecord[][] = [];

  const highPriorityConditions = [exactCondition, prefixCondition].filter(
    isDefined
  );

  if (highPriorityConditions.length > 0) {
    candidateIdGroups.push(
      ...(await Promise.all(
        highPriorityConditions.map((condition) =>
          findAliasCandidateIds(db, condition, limit, timing)
        )
      ))
    );
  }

  const highPriorityAliasIds = uniqueAliasIds(candidateIdGroups.flat());
  const hasExactCandidates =
    exactCondition !== undefined && candidateIdGroups[0]?.length > 0;
  const hasEnoughHigherRankedCandidates =
    highPriorityAliasIds.length >= limit || hasExactCandidates;
  let hasChosungCandidates = false;

  if (!hasEnoughHigherRankedCandidates && chosungCondition !== undefined) {
    const chosungCandidates = await findAliasCandidateIds(
      db,
      chosungCondition,
      limit,
      timing
    );
    hasChosungCandidates = chosungCandidates.length > 0;
    candidateIdGroups.push(chosungCandidates);
  }

  const stagedAliasIds = uniqueAliasIds(candidateIdGroups.flat());

  if (
    containsCondition !== undefined &&
    !hasExactCandidates &&
    !hasChosungCandidates &&
    stagedAliasIds.length < limit
  ) {
    candidateIdGroups.push(
      await findAliasCandidateIds(db, containsCondition, limit, timing)
    );
  }

  const aliasIds = uniqueAliasIds(candidateIdGroups.flat());

  if (aliasIds.length === 0) {
    return [];
  }

  return (await measureAsync(timing, "search.alias_detail", () =>
    db.songAlias.findMany({
      where: { id: { in: aliasIds } },
      select: aliasRecordSelect(),
      orderBy: aliasCandidateOrderBy()
    })
  )) as AliasRecord[];
}

function findAliasCandidateIds(
  db: SearchDbClient,
  condition: SearchAliasCondition,
  limit: number,
  timing: SearchTimingRecorder | undefined
): Promise<AliasIdRecord[]> {
  return measureAsync(
    timing,
    `search.candidate.${conditionTimingName(condition)}`,
    () =>
      db.songAlias.findMany({
        where: condition,
        select: { id: true },
        orderBy: aliasCandidateOrderBy(),
        take: candidateTakeForCondition(condition, limit)
      }) as Promise<AliasIdRecord[]>
  );
}

function candidateTakeForCondition(
  condition: SearchAliasCondition,
  limit: number
): number {
  if ("chosungAlias" in condition) {
    return Math.max(MIN_CHOSUNG_CANDIDATE_TAKE, limit * 5);
  }

  if ("equals" in condition.normalizedAlias) {
    return Math.max(MIN_EXACT_CANDIDATE_TAKE, limit * 2);
  }

  if ("startsWith" in condition.normalizedAlias) {
    return Math.max(MIN_PREFIX_CANDIDATE_TAKE, limit * 5);
  }

  return Math.min(
    MAX_PARTIAL_CANDIDATE_TAKE,
    Math.max(MIN_PARTIAL_CANDIDATE_TAKE, limit * 10)
  );
}

function aliasCandidateOrderBy(): SearchAliasOrderBy {
  return [
    { normalizedAlias: "asc" },
    { songId: "asc" },
    { alias: "asc" },
    { id: "asc" }
  ];
}

function uniqueAliasIds(aliases: AliasIdRecord[]): string[] {
  const aliasIds = new Set<string>();

  for (const alias of aliases) {
    aliasIds.add(alias.id);
  }

  return Array.from(aliasIds.values());
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function isChosungStartsWithCondition(
  condition: SearchAliasCondition
): condition is Extract<SearchAliasCondition, { chosungAlias: unknown }> {
  return "chosungAlias" in condition;
}

function isNormalizedEqualsCondition(
  condition: SearchAliasCondition
): condition is Extract<
  SearchAliasCondition,
  { normalizedAlias: { equals: string } }
> {
  return (
    "normalizedAlias" in condition && "equals" in condition.normalizedAlias
  );
}

function isNormalizedStartsWithCondition(
  condition: SearchAliasCondition
): condition is Extract<
  SearchAliasCondition,
  { normalizedAlias: { startsWith: string } }
> {
  return (
    "normalizedAlias" in condition && "startsWith" in condition.normalizedAlias
  );
}

function isNormalizedContainsCondition(
  condition: SearchAliasCondition
): condition is Extract<
  SearchAliasCondition,
  { normalizedAlias: { contains: string } }
> {
  return (
    "normalizedAlias" in condition && "contains" in condition.normalizedAlias
  );
}

async function findSearchSuggestions(
  db: SearchDbClient,
  query: SearchQuery,
  timing: SearchTimingRecorder | undefined
): Promise<string[]> {
  const conditions = buildSuggestionConditions(query);

  if (conditions.length === 0) {
    return [];
  }

  const aliases = (await measureAsync(timing, "search.suggestions", () =>
    db.songAlias.findMany({
      where: { OR: conditions },
      select: aliasSuggestionSelect(),
      orderBy: aliasCandidateOrderBy(),
      take: SUGGESTION_CANDIDATE_TAKE
    })
  )) as AliasSuggestionRecord[];

  return uniqueSuggestions(aliases, query).slice(0, 5);
}

function conditionTimingName(condition: SearchAliasCondition): string {
  if ("chosungAlias" in condition) {
    return "chosung_starts_with";
  }

  if ("equals" in condition.normalizedAlias) {
    return "normalized_equals";
  }

  if ("startsWith" in condition.normalizedAlias) {
    return "normalized_starts_with";
  }

  return "normalized_contains";
}

function buildSuggestionConditions(query: SearchQuery): SearchAliasCondition[] {
  const conditions: SearchAliasCondition[] = [];
  const normalizedPrefix = suggestionPrefix(query.normalizedQuery);

  if (normalizedPrefix !== null) {
    conditions.push({
      normalizedAlias: {
        startsWith: normalizedPrefix,
        mode: "insensitive"
      }
    });
  }

  if (canUseHangulChosungSearch(query.chosungQuery)) {
    conditions.push({
      chosungAlias: {
        startsWith: query.chosungQuery.slice(0, 2),
        mode: "insensitive"
      }
    });
  }

  return conditions;
}

function suggestionPrefix(normalizedQuery: string): string | null {
  if (normalizedQuery.length < 2) {
    return null;
  }

  return normalizedQuery.slice(0, Math.min(3, normalizedQuery.length));
}

function uniqueSuggestions(
  aliases: AliasSuggestionRecord[],
  query: SearchQuery
): string[] {
  const suggestions = new Set<string>();

  for (const alias of aliases) {
    if (
      alias.normalizedAlias === query.normalizedQuery ||
      alias.alias.trim() === ""
    ) {
      continue;
    }

    suggestions.add(alias.alias);
  }

  return Array.from(suggestions.values());
}

function aliasSuggestionSelect(): Extract<
  SearchAliasSelect,
  { alias: true; normalizedAlias: true }
> {
  return {
    id: true,
    alias: true,
    normalizedAlias: true
  };
}

function aliasRecordSelect(): Extract<SearchAliasSelect, { song: unknown }> {
  return {
    id: true,
    songId: true,
    alias: true,
    language: true,
    aliasType: true,
    normalizedAlias: true,
    chosungAlias: true,
    song: {
      select: {
        id: true,
        originalLanguage: true,
        canonicalTitle: true,
        displayTitle: true,
        canonicalArtist: true,
        releaseYear: true,
        tieIn: true,
        karaokeEntries: {
          select: {
            id: true,
            providerId: true,
            karaokeNumber: true,
            versionInfo: true,
            availabilityStatus: true,
            lastVerifiedAt: true
          },
          orderBy: [
            { providerId: "asc" },
            { availabilityStatus: "asc" },
            { versionInfo: "asc" },
            { karaokeNumber: "asc" },
            { id: "asc" }
          ]
        }
      }
    }
  };
}

function rankSongs(
  aliases: AliasRecord[],
  query: SearchQuery,
  options: {
    providerId?: string;
    defaultProviderId?: string;
    now: Date;
  }
): RankedSong[] {
  const rankedBySongId = new Map<string, RankedSong>();

  for (const alias of aliases) {
    const rank = matchRank(alias, query);

    if (rank === null) {
      continue;
    }

    const score = scoreForRank(rank);
    const existing = rankedBySongId.get(alias.songId);
    const matchedAlias = toAliasSummary(alias);

    if (existing === undefined) {
      rankedBySongId.set(alias.songId, {
        song: alias.song,
        matchedAliases: [matchedAlias],
        bestMatchRank: rank,
        bestScore: score
      });
      continue;
    }

    if (!existing.matchedAliases.some((item) => item.id === alias.id)) {
      existing.matchedAliases.push(matchedAlias);
    }

    if (rank < existing.bestMatchRank) {
      existing.bestMatchRank = rank;
      existing.bestScore = score;
    }
  }

  return Array.from(rankedBySongId.values()).sort((left, right) => {
    return (
      left.bestMatchRank - right.bestMatchRank ||
      providerAvailabilityScore(right.song, options.providerId) -
        providerAvailabilityScore(left.song, options.providerId) ||
      providerAvailabilityScore(right.song, options.defaultProviderId) -
        providerAvailabilityScore(left.song, options.defaultProviderId) ||
      availableEntryCount(right.song) - availableEntryCount(left.song) ||
      latestVerificationTime(right.song) - latestVerificationTime(left.song) ||
      left.song.displayTitle.localeCompare(right.song.displayTitle) ||
      left.song.canonicalArtist.localeCompare(right.song.canonicalArtist) ||
      left.song.id.localeCompare(right.song.id)
    );
  });
}

function matchRank(alias: AliasRecord, query: SearchQuery): number | null {
  if (alias.normalizedAlias === query.normalizedQuery) {
    return 1;
  }

  if (normalizeSearchText(alias.alias) === query.normalizedQuery) {
    return 2;
  }

  if (alias.normalizedAlias.startsWith(query.normalizedQuery)) {
    return 3;
  }

  if (
    canUseHangulChosungSearch(query.chosungQuery) &&
    alias.chosungAlias?.startsWith(query.chosungQuery) === true
  ) {
    return 4;
  }

  if (alias.normalizedAlias.includes(query.normalizedQuery)) {
    return 5;
  }

  return null;
}

function scoreForRank(rank: number): number {
  return Math.max(0, 110 - rank * 10);
}

function providerAvailabilityScore(
  song: SongRecord,
  providerId: string | undefined
): number {
  if (providerId === undefined) {
    return 0;
  }

  return song.karaokeEntries.some(
    (entry) =>
      entry.providerId === providerId &&
      entry.availabilityStatus === AVAILABLE_STATUS
  )
    ? 1
    : 0;
}

function availableEntryCount(song: SongRecord): number {
  return song.karaokeEntries.filter(
    (entry) => entry.availabilityStatus === AVAILABLE_STATUS
  ).length;
}

function latestVerificationTime(song: SongRecord): number {
  return Math.max(
    0,
    ...song.karaokeEntries.map((entry) => {
      const date = parseNullableDate(entry.lastVerifiedAt);
      return date?.getTime() ?? 0;
    })
  );
}

function toSearchResultItem(
  ranked: RankedSong,
  options: { now: Date }
): SearchResultItem {
  return {
    song: {
      id: ranked.song.id,
      original_language: ranked.song.originalLanguage,
      canonical_title: ranked.song.canonicalTitle,
      display_title: ranked.song.displayTitle,
      canonical_artist: ranked.song.canonicalArtist,
      release_year: ranked.song.releaseYear,
      tie_in: ranked.song.tieIn,
      matched_aliases: ranked.matchedAliases
        .sort((left, right) => left.id.localeCompare(right.id))
        .map(toMatchedAlias)
    },
    karaoke_entries: ranked.song.karaokeEntries.map((entry) =>
      toSearchKaraokeEntry(entry, options)
    ),
    distinguishing_labels: buildDistinguishingLabels(ranked.song),
    relevance_score: ranked.bestScore
  };
}

function toAliasSummary(alias: AliasRecord): AliasSummaryRecord {
  return {
    id: alias.id,
    alias: alias.alias,
    language: alias.language,
    aliasType: alias.aliasType,
    normalizedAlias: alias.normalizedAlias,
    chosungAlias: alias.chosungAlias
  };
}

function toMatchedAlias(alias: AliasSummaryRecord): SearchMatchedAlias {
  return {
    id: alias.id,
    alias: alias.alias,
    language: alias.language,
    alias_type: alias.aliasType
  };
}

function toSearchKaraokeEntry(
  entry: KaraokeEntryRecord,
  options: { now: Date }
): SearchKaraokeEntry {
  return {
    id: entry.id,
    provider_id: entry.providerId,
    karaoke_number: entry.karaokeNumber,
    version_info: entry.versionInfo,
    availability_status: entry.availabilityStatus,
    last_verified_at: formatNullableDate(entry.lastVerifiedAt),
    is_stale: isStaleVerification(entry.lastVerifiedAt, options.now)
  };
}

function buildDistinguishingLabels(song: SongRecord): string[] {
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
  const date = parseNullableDate(value);

  if (date === null) {
    return null;
  }

  return date.toISOString().slice(0, 10);
}

function parseNullableDate(value: Date | string | null): Date | null {
  if (value === null) {
    return null;
  }

  if (value instanceof Date) {
    return value;
  }

  const parsed = new Date(value);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function startOfUtcDay(value: Date): Date {
  return new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate())
  );
}

function emptySearchResponse(query: SearchQuery): SearchResponse {
  return {
    query: query.query,
    normalized_query: query.normalizedQuery,
    items: [],
    next_cursor: null,
    suggestions: []
  };
}
