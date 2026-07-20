"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent
} from "react";
import Link from "next/link";
import { GoogleLoginDialog } from "@/components/auth/GoogleLoginDialog";
import {
  fetchProviders,
  fetchSearchResults,
  selectInitialProvider
} from "@/lib/api/search-ui";
import {
  createGoogleSignInUrl,
  fetchBrowserAuthState
} from "@/lib/auth/client";
import {
  deleteFavorite,
  fetchAllFavoriteSongIds,
  isUnauthenticatedFavoriteError,
  putFavorite
} from "@/lib/favorites/client";
import {
  clearPendingFavoriteIntent,
  writePendingFavoriteIntent
} from "@/lib/favorites/pending-intent";
import {
  bootstrapDefaultProvider,
  saveDefaultProviderSelectionLocally,
  syncDefaultProviderSelection,
  type DefaultProviderPersistenceMode
} from "@/lib/preferences/default-provider-client";
import type { ProviderListItem } from "@/lib/providers/providers";
import type { SearchResponse, SearchResultItem } from "@/lib/search/search";
import {
  clearServerSearchHistory,
  createSearchHistoryMergeId,
  deleteServerSearchHistoryItem,
  fetchServerSearchHistory,
  isUnauthenticatedSearchHistoryError,
  mergeServerSearchHistory,
  postServerSearchHistory
} from "@/lib/search-history/client";
import type { SearchHistoryItem } from "@/lib/search-history/service";
import {
  addStoredSearchHistory,
  clearStoredSearchHistory,
  readStoredSearchHistory,
  removeStoredSearchHistoryItem,
  type StoredSearchHistoryItem
} from "@/lib/search-history/storage";
import { SearchResultCard } from "./SearchResultCard";

type RequestState = "idle" | "loading" | "success" | "error";
type FavoriteSessionState =
  "loading" | "authenticated" | "guest" | "unavailable" | "expired";
type FavoriteNotice = Readonly<{
  message: string;
  retry: "session" | "favorites" | null;
}>;
type SearchHistoryMode =
  "loading" | "authenticated" | "guest" | "unavailable" | "expired";
type RecentSearchItem = SearchHistoryItem | StoredSearchHistoryItem;
type SearchHistoryNotice = Readonly<{
  message: string;
  retry: "load" | "merge" | null;
}>;
const SEARCH_REQUEST_TIMEOUT_MS = 8_000;

export function MobileSearchPage({
  navigateToAuth = (url) => window.location.assign(url)
}: {
  navigateToAuth?: (url: string) => void;
} = {}) {
  const [providers, setProviders] = useState<ProviderListItem[]>([]);
  const [providersStatus, setProvidersStatus] =
    useState<RequestState>("loading");
  const [providerError, setProviderError] = useState<string | null>(null);
  const [selectedProviderId, setSelectedProviderId] = useState<
    string | undefined
  >();
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [submittedProviderId, setSubmittedProviderId] = useState<
    string | undefined
  >();
  const [successfulQuery, setSuccessfulQuery] = useState("");
  const [successfulProviderName, setSuccessfulProviderName] = useState<
    string | undefined
  >();
  const [searchStatus, setSearchStatus] = useState<RequestState>("idle");
  const [searchError, setSearchError] = useState<string | null>(null);
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [expandedSongIds, setExpandedSongIds] = useState<Set<string>>(
    () => new Set()
  );
  const [favoriteSessionStatus, setFavoriteSessionStatus] =
    useState<FavoriteSessionState>("loading");
  const [favoritesStatus, setFavoritesStatus] = useState<RequestState>("idle");
  const [favoriteSongIds, setFavoriteSongIds] = useState<Set<string>>(
    () => new Set()
  );
  const [pendingFavoriteSongIds, setPendingFavoriteSongIds] = useState<
    Set<string>
  >(() => new Set());
  const [favoriteNotice, setFavoriteNotice] = useState<FavoriteNotice | null>(
    null
  );
  const [loginPrompt, setLoginPrompt] = useState<{
    songId: string;
    intent: "add" | "reauthenticate";
    reason: "guest" | "expired";
  } | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginSubmitting, setLoginSubmitting] = useState(false);
  const [loginIntentStored, setLoginIntentStored] = useState(false);
  const [searchHistoryMode, setSearchHistoryMode] =
    useState<SearchHistoryMode>("loading");
  const [searchHistoryStatus, setSearchHistoryStatus] =
    useState<RequestState>("loading");
  const [recentSearches, setRecentSearches] = useState<RecentSearchItem[]>([]);
  const [searchHistoryNotice, setSearchHistoryNotice] =
    useState<SearchHistoryNotice | null>(null);
  const [searchHistoryMutationPending, setSearchHistoryMutationPending] =
    useState(false);
  const [searchHistoryRecordingPending, setSearchHistoryRecordingPending] =
    useState(false);
  const latestSearchRequestId = useRef(0);
  const activeSearchRequest = useRef<{
    controller: AbortController;
    timeoutId: ReturnType<typeof setTimeout>;
  } | null>(null);
  const selectedProviderIdRef = useRef<string | undefined>(undefined);
  const providerSelectionVersion = useRef(0);
  const lastUserSelectedProviderId = useRef<string | undefined>(undefined);
  const preferenceMode = useRef<DefaultProviderPersistenceMode | "unknown">(
    "unknown"
  );
  const preferenceWriteQueue = useRef<Promise<void>>(Promise.resolve());
  const favoriteBootstrapVersion = useRef(0);
  const pendingFavoriteSongIdsRef = useRef<Set<string>>(new Set());
  const searchHistoryModeRef = useRef<SearchHistoryMode>("loading");
  const searchHistoryBootstrapVersion = useRef(0);
  const searchHistoryMergeAttempt = useRef<{
    mergeId: string;
    recentSearches: StoredSearchHistoryItem[];
  } | null>(null);
  const searchHistoryOperationQueue = useRef<Promise<void>>(Promise.resolve());
  const pendingSearchHistoryWrites = useRef(0);

  const updateSearchHistoryMode = useCallback(
    (mode: SearchHistoryMode): void => {
      searchHistoryModeRef.current = mode;
      setSearchHistoryMode(mode);
    },
    []
  );

  const loadSearchHistoryPersonalization =
    useCallback(async (): Promise<void> => {
      const requestVersion = searchHistoryBootstrapVersion.current + 1;
      searchHistoryBootstrapVersion.current = requestVersion;
      updateSearchHistoryMode("loading");
      setSearchHistoryStatus("loading");
      setSearchHistoryNotice(null);

      const auth = await fetchBrowserAuthState();
      if (searchHistoryBootstrapVersion.current !== requestVersion) {
        return;
      }

      const localSearches = readStoredSearchHistory();
      if (auth.status === "guest") {
        searchHistoryMergeAttempt.current = null;
        updateSearchHistoryMode("guest");
        setRecentSearches(localSearches);
        setSearchHistoryStatus("success");
        return;
      }

      if (auth.status === "unavailable") {
        updateSearchHistoryMode("unavailable");
        setRecentSearches([]);
        setSearchHistoryStatus("error");
        setSearchHistoryNotice({
          message:
            "로그인 상태를 확인하지 못해 최근 검색어를 불러오지 못했습니다. 검색은 계속 사용할 수 있습니다.",
          retry: "load"
        });
        return;
      }

      updateSearchHistoryMode("authenticated");

      try {
        if (localSearches.length > 0) {
          if (
            searchHistoryMergeAttempt.current === null ||
            !areStoredSearchHistoriesEqual(
              searchHistoryMergeAttempt.current.recentSearches,
              localSearches
            )
          ) {
            searchHistoryMergeAttempt.current = {
              mergeId: createSearchHistoryMergeId(),
              recentSearches: localSearches
            };
          }
          const attempt = searchHistoryMergeAttempt.current;
          const items = await enqueueSearchHistoryOperation(
            searchHistoryOperationQueue,
            () =>
              mergeServerSearchHistory({
                mergeId: attempt.mergeId,
                recentSearches: attempt.recentSearches
              })
          );

          if (searchHistoryBootstrapVersion.current !== requestVersion) {
            return;
          }

          setRecentSearches(items);
          if (
            !areStoredSearchHistoriesEqual(
              readStoredSearchHistory(),
              attempt.recentSearches
            ) ||
            !clearStoredSearchHistory()
          ) {
            setSearchHistoryStatus("error");
            setSearchHistoryNotice({
              message:
                "병합은 완료됐지만 브라우저의 이전 기록을 정리하지 못했습니다. 다시 시도해 주세요.",
              retry: "merge"
            });
            return;
          }

          searchHistoryMergeAttempt.current = null;
          setSearchHistoryStatus("success");
          setSearchHistoryNotice(null);
          return;
        }

        searchHistoryMergeAttempt.current = null;
        const items = await enqueueSearchHistoryOperation(
          searchHistoryOperationQueue,
          () => fetchServerSearchHistory()
        );
        if (searchHistoryBootstrapVersion.current !== requestVersion) {
          return;
        }
        setRecentSearches(items);
        setSearchHistoryStatus("success");
        setSearchHistoryNotice(null);
      } catch (error) {
        if (searchHistoryBootstrapVersion.current !== requestVersion) {
          return;
        }

        if (isUnauthenticatedSearchHistoryError(error)) {
          updateSearchHistoryMode("expired");
          setRecentSearches(localSearches);
          setSearchHistoryNotice({
            message:
              "로그인 세션이 만료되어 최근 검색어를 동기화하지 못했습니다. 검색은 계속 사용할 수 있습니다.",
            retry: "load"
          });
        } else {
          setRecentSearches(localSearches);
          setSearchHistoryNotice({
            message:
              localSearches.length > 0
                ? "최근 검색어 병합에 실패했습니다. 로컬 기록은 유지되며 다시 시도할 수 있습니다."
                : "서버 최근 검색어를 불러오지 못했습니다. 검색은 계속 사용할 수 있습니다.",
            retry: localSearches.length > 0 ? "merge" : "load"
          });
        }
        setSearchHistoryStatus("error");
      }
    }, [updateSearchHistoryMode]);

  const loadFavoritePersonalization = useCallback(async (): Promise<void> => {
    const requestVersion = favoriteBootstrapVersion.current + 1;
    favoriteBootstrapVersion.current = requestVersion;
    setFavoriteSessionStatus("loading");
    setFavoritesStatus("idle");

    const auth = await fetchBrowserAuthState();
    if (favoriteBootstrapVersion.current !== requestVersion) {
      return;
    }

    if (auth.status !== "authenticated") {
      setFavoriteSessionStatus(auth.status);
      setFavoritesStatus("idle");
      return;
    }

    setFavoriteSessionStatus("authenticated");
    setFavoritesStatus("loading");

    try {
      const songIds = await fetchAllFavoriteSongIds();
      if (favoriteBootstrapVersion.current !== requestVersion) {
        return;
      }

      setFavoriteSongIds(songIds);
      setFavoritesStatus("success");
      setFavoriteNotice(null);
    } catch (error) {
      if (favoriteBootstrapVersion.current !== requestVersion) {
        return;
      }

      if (isUnauthenticatedFavoriteError(error)) {
        setFavoriteSessionStatus("expired");
        setFavoritesStatus("idle");
      } else {
        setFavoritesStatus("error");
      }
    }
  }, []);

  const updateSelectedProvider = useCallback(
    (providerId: string | undefined): void => {
      selectedProviderIdRef.current = providerId;
      setSelectedProviderId(providerId);
    },
    []
  );

  const persistProviderSelection = useCallback(
    (
      providerId: string,
      mode: DefaultProviderPersistenceMode | "unknown" = preferenceMode.current
    ): void => {
      saveDefaultProviderSelectionLocally(providerId);

      if (mode !== "authenticated") {
        return;
      }

      preferenceWriteQueue.current = preferenceWriteQueue.current
        .catch(() => undefined)
        .then(async () => {
          await syncDefaultProviderSelection({ providerId });
        });
    },
    []
  );

  useEffect(() => {
    let isMounted = true;

    void Promise.resolve().then(() => {
      if (isMounted) {
        return loadSearchHistoryPersonalization();
      }
    });

    fetchProviders()
      .then((items) => {
        if (!isMounted) {
          return;
        }

        const operationalDefaultId = selectInitialProvider(items);
        const bootstrapSelectionVersion = providerSelectionVersion.current;

        setProviders(items);
        updateSelectedProvider(operationalDefaultId);
        setProvidersStatus("success");
        setProviderError(null);

        void bootstrapDefaultProvider({ providers: items }).then((result) => {
          preferenceMode.current = result.mode;

          if (!isMounted) {
            return;
          }

          if (
            providerSelectionVersion.current === bootstrapSelectionVersion &&
            lastUserSelectedProviderId.current === undefined
          ) {
            updateSelectedProvider(result.selectedProviderId);
          } else {
            const latestProviderId = selectedProviderIdRef.current;
            if (
              result.mode === "authenticated" &&
              latestProviderId !== undefined
            ) {
              persistProviderSelection(latestProviderId, result.mode);
            }
          }

          void loadFavoritePersonalization();
        });
      })
      .catch((error: unknown) => {
        if (!isMounted) {
          return;
        }

        setProviders([]);
        setSelectedProviderId(undefined);
        setProvidersStatus("error");
        setProviderError(
          error instanceof Error
            ? error.message
            : "제공사 목록을 불러오지 못했습니다."
        );
        void loadFavoritePersonalization();
      });

    return () => {
      isMounted = false;
      favoriteBootstrapVersion.current += 1;
      searchHistoryBootstrapVersion.current += 1;
      if (activeSearchRequest.current !== null) {
        clearTimeout(activeSearchRequest.current.timeoutId);
        activeSearchRequest.current.controller.abort();
        activeSearchRequest.current = null;
      }
    };
  }, [
    loadFavoritePersonalization,
    loadSearchHistoryPersonalization,
    persistProviderSelection,
    updateSelectedProvider
  ]);

  async function handleToggleFavorite(songId: string): Promise<void> {
    if (
      favoriteSessionStatus === "guest" ||
      favoriteSessionStatus === "expired"
    ) {
      setLoginPrompt({
        songId,
        intent: "add",
        reason: favoriteSessionStatus === "expired" ? "expired" : "guest"
      });
      setLoginError(null);
      return;
    }

    if (favoriteSessionStatus !== "authenticated") {
      setFavoriteNotice({
        message:
          "로그인 상태를 확인하지 못했습니다. 검색은 계속 사용할 수 있습니다.",
        retry: "session"
      });
      return;
    }

    if (favoritesStatus !== "success") {
      setFavoriteNotice({
        message:
          "즐겨찾기 상태를 불러오지 못했습니다. 확인 후 다시 시도해 주세요.",
        retry: "favorites"
      });
      return;
    }

    if (pendingFavoriteSongIdsRef.current.has(songId)) {
      return;
    }

    const wasFavorite = favoriteSongIds.has(songId);
    pendingFavoriteSongIdsRef.current.add(songId);
    setPendingFavoriteSongIds((current) => new Set(current).add(songId));
    setFavoriteSongIds((current) => {
      const next = new Set(current);
      if (wasFavorite) {
        next.delete(songId);
      } else {
        next.add(songId);
      }
      return next;
    });
    setFavoriteNotice(null);

    try {
      if (wasFavorite) {
        await deleteFavorite(songId);
      } else {
        await putFavorite(songId);
      }
    } catch (error) {
      setFavoriteSongIds((current) => {
        const next = new Set(current);
        if (wasFavorite) {
          next.add(songId);
        } else {
          next.delete(songId);
        }
        return next;
      });

      if (isUnauthenticatedFavoriteError(error)) {
        setFavoriteSessionStatus("expired");
        setLoginPrompt({
          songId,
          intent: wasFavorite ? "reauthenticate" : "add",
          reason: "expired"
        });
        setLoginError(null);
      } else {
        setFavoriteNotice({
          message:
            "즐겨찾기 변경에 실패해 이전 상태로 되돌렸습니다. 검색 결과는 유지됩니다.",
          retry: null
        });
      }
    } finally {
      pendingFavoriteSongIdsRef.current.delete(songId);
      setPendingFavoriteSongIds((current) => {
        const next = new Set(current);
        next.delete(songId);
        return next;
      });
    }
  }

  async function handleGoogleLogin(): Promise<void> {
    if (loginPrompt === null || loginSubmitting) {
      return;
    }

    setLoginSubmitting(true);
    setLoginError(null);

    if (loginPrompt.intent === "add") {
      if (!writePendingFavoriteIntent(loginPrompt.songId)) {
        setLoginError(
          "브라우저에 선택한 곡을 안전하게 보관하지 못했습니다. 저장소 설정을 확인하고 다시 시도해 주세요."
        );
        setLoginSubmitting(false);
        return;
      }
      setLoginIntentStored(true);
    }

    try {
      const url = await createGoogleSignInUrl({ callbackURL: "/favorites" });
      navigateToAuth(url);
    } catch {
      setLoginError(
        "로그인 요청을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요."
      );
      setLoginSubmitting(false);
    }
  }

  function handleCancelLogin(): void {
    if (loginIntentStored && !clearPendingFavoriteIntent()) {
      setLoginError(
        "저장된 자동 추가 요청을 취소하지 못했습니다. 브라우저 저장소 설정을 확인하고 다시 시도해 주세요."
      );
      return;
    }
    setLoginIntentStored(false);
    setLoginSubmitting(false);
    setLoginError(null);
    setLoginPrompt(null);
  }

  function handleProviderChange(providerId: string | undefined): void {
    providerSelectionVersion.current += 1;
    lastUserSelectedProviderId.current = providerId;
    updateSelectedProvider(providerId);

    if (providerId !== undefined) {
      persistProviderSelection(providerId);
    }
  }

  function recordSuccessfulSearch(queryToRecord: string): void {
    const mode = searchHistoryModeRef.current;

    if (mode === "guest" || mode === "expired") {
      const items = addStoredSearchHistory(queryToRecord);
      if (items === undefined) {
        setSearchHistoryNotice({
          message:
            "검색 결과는 표시했지만 브라우저에 최근 검색어를 저장하지 못했습니다.",
          retry: null
        });
        return;
      }

      searchHistoryMergeAttempt.current = null;
      setRecentSearches(items);
      setSearchHistoryStatus("success");
      return;
    }

    if (mode !== "authenticated") {
      setSearchHistoryNotice({
        message:
          "검색 결과는 표시했지만 로그인 상태 문제로 최근 검색어를 기록하지 못했습니다.",
        retry: "load"
      });
      return;
    }

    pendingSearchHistoryWrites.current += 1;
    setSearchHistoryRecordingPending(true);
    void enqueueSearchHistoryOperation(
      searchHistoryOperationQueue,
      async () => {
        try {
          const item = await postServerSearchHistory(queryToRecord);
          if (searchHistoryModeRef.current !== "authenticated") {
            return;
          }
          setRecentSearches((current) => upsertRecentSearch(current, item));
        } catch (error) {
          if (isUnauthenticatedSearchHistoryError(error)) {
            updateSearchHistoryMode("expired");
            const items = addStoredSearchHistory(queryToRecord);
            if (items !== undefined) {
              searchHistoryMergeAttempt.current = null;
              setRecentSearches(items);
              setSearchHistoryStatus("success");
            }
            setSearchHistoryNotice({
              message:
                "로그인 세션이 만료되어 이 검색어는 브라우저에 보관했습니다.",
              retry: "load"
            });
          } else {
            setSearchHistoryNotice({
              message:
                "검색 결과는 표시했지만 서버에 최근 검색어를 기록하지 못했습니다.",
              retry: null
            });
          }
        } finally {
          pendingSearchHistoryWrites.current -= 1;
          setSearchHistoryRecordingPending(
            pendingSearchHistoryWrites.current > 0
          );
        }
      }
    );
  }

  async function handleDeleteRecentSearch(
    item: RecentSearchItem
  ): Promise<void> {
    if (searchHistoryMutationPending) {
      return;
    }

    const mode = searchHistoryModeRef.current;
    if (mode === "guest" || mode === "expired") {
      const items = removeStoredSearchHistoryItem(item.normalized_query);
      if (items === undefined) {
        setSearchHistoryNotice({
          message: "브라우저의 최근 검색어를 삭제하지 못했습니다.",
          retry: null
        });
      } else {
        searchHistoryMergeAttempt.current = null;
        setRecentSearches(items);
        setSearchHistoryNotice(null);
      }
      return;
    }

    if (mode !== "authenticated" || !("id" in item)) {
      return;
    }

    const previous = recentSearches;
    setSearchHistoryMutationPending(true);
    setRecentSearches((current) => current.filter((entry) => entry !== item));
    setSearchHistoryNotice(null);
    try {
      await enqueueSearchHistoryOperation(searchHistoryOperationQueue, () =>
        deleteServerSearchHistoryItem(item.id)
      );
    } catch (error) {
      setRecentSearches(previous);
      setSearchHistoryNotice({
        message: "최근 검색어 삭제에 실패해 이전 목록과 순서로 복구했습니다.",
        retry: null
      });
      if (isUnauthenticatedSearchHistoryError(error)) {
        updateSearchHistoryMode("expired");
        setSearchHistoryStatus("error");
      }
    } finally {
      setSearchHistoryMutationPending(false);
    }
  }

  async function handleClearRecentSearches(): Promise<void> {
    if (searchHistoryMutationPending || recentSearches.length === 0) {
      return;
    }

    const mode = searchHistoryModeRef.current;
    if (mode === "guest" || mode === "expired") {
      if (clearStoredSearchHistory()) {
        searchHistoryMergeAttempt.current = null;
        setRecentSearches([]);
        setSearchHistoryNotice(null);
      } else {
        setSearchHistoryNotice({
          message: "브라우저의 최근 검색어를 전체 삭제하지 못했습니다.",
          retry: null
        });
      }
      return;
    }

    if (mode !== "authenticated") {
      return;
    }

    const previous = recentSearches;
    setSearchHistoryMutationPending(true);
    setRecentSearches([]);
    setSearchHistoryNotice(null);
    try {
      await enqueueSearchHistoryOperation(searchHistoryOperationQueue, () =>
        clearServerSearchHistory()
      );
    } catch (error) {
      setRecentSearches(previous);
      setSearchHistoryNotice({
        message:
          "최근 검색어 전체 삭제에 실패해 이전 목록과 순서로 복구했습니다.",
        retry: null
      });
      if (isUnauthenticatedSearchHistoryError(error)) {
        updateSearchHistoryMode("expired");
        setSearchHistoryStatus("error");
      }
    } finally {
      setSearchHistoryMutationPending(false);
    }
  }

  async function runSearch(
    nextQuery: string,
    providerId: string | undefined = selectedProviderId
  ) {
    const trimmedQuery = nextQuery.trim();

    if (trimmedQuery.length === 0) {
      return;
    }

    const requestId = latestSearchRequestId.current + 1;
    latestSearchRequestId.current = requestId;
    if (activeSearchRequest.current !== null) {
      clearTimeout(activeSearchRequest.current.timeoutId);
      activeSearchRequest.current.controller.abort();
    }
    const controller = new AbortController();
    const request = {
      controller,
      timeoutId: setTimeout(() => controller.abort(), SEARCH_REQUEST_TIMEOUT_MS)
    };
    activeSearchRequest.current = request;

    setSubmittedQuery(trimmedQuery);
    setSubmittedProviderId(providerId);
    const providerName = providers.find(
      (provider) => provider.id === providerId
    )?.name;

    setExpandedSongIds(new Set());
    setSearchStatus("loading");
    setSearchError(null);

    try {
      const response: SearchResponse = await fetchSearchResults(
        {
          query: trimmedQuery,
          providerId
        },
        fetch,
        controller.signal
      );

      if (latestSearchRequestId.current !== requestId) {
        return;
      }

      setResults(response.items);
      setSuggestions(response.suggestions);
      setSuccessfulQuery(response.query);
      setSuccessfulProviderName(providerName);
      setSearchStatus("success");
      recordSuccessfulSearch(response.query);
    } catch (error) {
      if (latestSearchRequestId.current !== requestId) {
        return;
      }

      setSearchStatus("error");
      setSearchError(
        controller.signal.aborted
          ? "검색 요청 시간이 초과되었습니다."
          : error instanceof Error
            ? error.message
            : "검색 요청에 실패했습니다."
      );
    } finally {
      clearTimeout(request.timeoutId);
      if (activeSearchRequest.current === request) {
        activeSearchRequest.current = null;
      }
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void runSearch(query);
  }

  function handleSuggestionSearch(suggestion: string) {
    setQuery(suggestion);
    void runSearch(suggestion);
  }

  function handleRecentSearch(queryToSearch: string) {
    setQuery(queryToSearch);
    void runSearch(queryToSearch);
  }

  const canSubmit = query.trim().length > 0 && searchStatus !== "loading";

  return (
    <main className="search-shell">
      <div className="mobile-frame">
        <section className="search-hero" aria-labelledby="page-title">
          <div className="hero-navigation">
            <p className="eyebrow">KaraokeNumberFinder</p>
            <Link className="back-link" href="/favorites">
              즐겨찾기
            </Link>
          </div>
          <h1 id="page-title">노래방 번호 검색</h1>
        </section>

        <section className="search-panel" aria-label="검색">
          <form className="search-form" role="search" onSubmit={handleSubmit}>
            <label className="field-label" htmlFor="song-query">
              검색어
            </label>
            <div className="search-row">
              <input
                id="song-query"
                className="search-input"
                name="q"
                type="search"
                value={query}
                placeholder="곡명, 가수, 원제, 초성"
                enterKeyHint="search"
                autoComplete="off"
                onChange={(event) => setQuery(event.target.value)}
              />
              <button
                className="search-button"
                type="submit"
                disabled={!canSubmit}
              >
                검색
              </button>
            </div>

            <label className="field-label" htmlFor="provider-select">
              제공사
            </label>
            <select
              id="provider-select"
              className="provider-select"
              value={selectedProviderId ?? ""}
              disabled={providers.length === 0}
              onChange={(event) =>
                handleProviderChange(event.target.value || undefined)
              }
            >
              {providers.length === 0 ? (
                <option value="">제공사 미선택</option>
              ) : (
                providers.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.name}
                  </option>
                ))
              )}
            </select>

            {providersStatus === "loading" ? (
              <p className="form-note">제공사 목록을 불러오는 중입니다.</p>
            ) : null}
            {providersStatus === "error" ? (
              <p className="form-note form-note-error">
                {providerError} 제공사 없이도 검색할 수 있습니다.
              </p>
            ) : null}
          </form>
        </section>

        <RecentSearchesPanel
          mode={searchHistoryMode}
          status={searchHistoryStatus}
          items={recentSearches}
          notice={searchHistoryNotice}
          mutationPending={searchHistoryMutationPending}
          recordingPending={searchHistoryRecordingPending}
          onRetry={() => void loadSearchHistoryPersonalization()}
          onSearch={handleRecentSearch}
          onDelete={(item) => void handleDeleteRecentSearch(item)}
          onClear={() => void handleClearRecentSearches()}
        />

        <section className="results-section" aria-live="polite">
          {favoriteNotice === null ? null : (
            <div className="inline-status inline-status-error" role="alert">
              <span>{favoriteNotice.message}</span>
              <div className="inline-actions">
                {favoriteNotice.retry === null ? null : (
                  <button
                    className="link-button"
                    type="button"
                    onClick={() => void loadFavoritePersonalization()}
                  >
                    다시 확인
                  </button>
                )}
                <button
                  className="link-button"
                  type="button"
                  onClick={() => setFavoriteNotice(null)}
                >
                  닫기
                </button>
              </div>
            </div>
          )}
          <SearchState
            status={searchStatus}
            submittedQuery={submittedQuery}
            successfulQuery={successfulQuery}
            successfulProviderName={successfulProviderName}
            selectedProviderId={selectedProviderId}
            providers={providers}
            results={results}
            suggestions={suggestions}
            expandedSongIds={expandedSongIds}
            favoriteSongIds={favoriteSongIds}
            pendingFavoriteSongIds={pendingFavoriteSongIds}
            error={searchError}
            onToggleExpanded={(songId) =>
              setExpandedSongIds((current) => {
                const next = new Set(current);

                if (next.has(songId)) {
                  next.delete(songId);
                } else {
                  next.add(songId);
                }

                return next;
              })
            }
            onRetry={() => void runSearch(submittedQuery, submittedProviderId)}
            onSearchSuggestion={handleSuggestionSearch}
            onToggleFavorite={(songId) => void handleToggleFavorite(songId)}
          />
        </section>
      </div>
      {loginPrompt === null ? null : (
        <GoogleLoginDialog
          reason={loginPrompt.reason}
          intent={loginPrompt.intent}
          error={loginError}
          isSubmitting={loginSubmitting}
          onCancel={handleCancelLogin}
          onLogin={() => void handleGoogleLogin()}
        />
      )}
    </main>
  );
}

function enqueueSearchHistoryOperation<T>(
  queue: { current: Promise<void> },
  operation: () => Promise<T>
): Promise<T> {
  const queued = queue.current.then(operation, operation);
  queue.current = queued.then(
    () => undefined,
    () => undefined
  );
  return queued;
}

function areStoredSearchHistoriesEqual(
  left: readonly StoredSearchHistoryItem[],
  right: readonly StoredSearchHistoryItem[]
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (item, index) =>
        item.query === right[index]?.query &&
        item.normalized_query === right[index]?.normalized_query &&
        item.searched_at === right[index]?.searched_at
    )
  );
}

function RecentSearchesPanel({
  mode,
  status,
  items,
  notice,
  mutationPending,
  recordingPending,
  onRetry,
  onSearch,
  onDelete,
  onClear
}: {
  mode: SearchHistoryMode;
  status: RequestState;
  items: RecentSearchItem[];
  notice: SearchHistoryNotice | null;
  mutationPending: boolean;
  recordingPending: boolean;
  onRetry: () => void;
  onSearch: (query: string) => void;
  onDelete: (item: RecentSearchItem) => void;
  onClear: () => void;
}) {
  const mutationsDisabled =
    mutationPending ||
    recordingPending ||
    status === "loading" ||
    status === "error";

  return (
    <section
      className="recent-searches"
      aria-labelledby="recent-search-title"
      aria-live="polite"
    >
      <div className="recent-searches-heading">
        <h2 id="recent-search-title">최근 검색어</h2>
        {items.length === 0 ? null : (
          <button
            className="link-button"
            type="button"
            disabled={mutationsDisabled}
            aria-label="최근 검색어 전체 삭제"
            onClick={onClear}
          >
            전체 삭제
          </button>
        )}
      </div>

      {status === "loading" ? (
        <p className="recent-searches-note">최근 검색어를 불러오는 중입니다.</p>
      ) : null}
      {recordingPending ? (
        <p className="recent-searches-note">최근 검색어를 저장하는 중입니다.</p>
      ) : null}
      {notice === null ? null : (
        <div className="recent-searches-error">
          <span>{notice.message}</span>
          {notice.retry === null ? null : (
            <button className="link-button" type="button" onClick={onRetry}>
              다시 시도
            </button>
          )}
        </div>
      )}
      {status !== "loading" && items.length === 0 && notice === null ? (
        <p className="recent-searches-note">최근 검색어가 없습니다.</p>
      ) : null}
      {items.length > 0 ? (
        <ul className="recent-search-list">
          {items.map((item) => (
            <li key={item.normalized_query}>
              <button
                className="recent-search-query"
                type="button"
                onClick={() => onSearch(item.query)}
              >
                {item.query}
              </button>
              <button
                className="recent-search-delete"
                type="button"
                disabled={mutationsDisabled}
                aria-label={`최근 검색어 ${item.query} 삭제`}
                onClick={() => onDelete(item)}
              >
                삭제
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {mode === "expired" && notice === null ? (
        <p className="recent-searches-note">
          로그인 세션이 만료되어 새 검색어는 이 브라우저에 보관됩니다.
        </p>
      ) : null}
    </section>
  );
}

function upsertRecentSearch(
  items: RecentSearchItem[],
  item: SearchHistoryItem
): RecentSearchItem[] {
  return [
    item,
    ...items.filter(
      (existing) => existing.normalized_query !== item.normalized_query
    )
  ]
    .sort(
      (left, right) =>
        new Date(right.searched_at).getTime() -
        new Date(left.searched_at).getTime()
    )
    .slice(0, 10);
}

function SearchState({
  status,
  submittedQuery,
  successfulQuery,
  successfulProviderName,
  selectedProviderId,
  providers,
  results,
  suggestions,
  expandedSongIds,
  favoriteSongIds,
  pendingFavoriteSongIds,
  error,
  onToggleExpanded,
  onRetry,
  onSearchSuggestion,
  onToggleFavorite
}: {
  status: RequestState;
  submittedQuery: string;
  successfulQuery: string;
  successfulProviderName: string | undefined;
  selectedProviderId: string | undefined;
  providers: ProviderListItem[];
  results: SearchResultItem[];
  suggestions: string[];
  expandedSongIds: Set<string>;
  favoriteSongIds: Set<string>;
  pendingFavoriteSongIds: Set<string>;
  error: string | null;
  onToggleExpanded: (songId: string) => void;
  onRetry: () => void;
  onSearchSuggestion: (suggestion: string) => void;
  onToggleFavorite: (songId: string) => void;
}) {
  const hasResults = results.length > 0;

  if (status === "idle") {
    return (
      <div className="empty-state">
        <p className="empty-title">검색어를 입력하고 검색을 실행하세요.</p>
        <p className="empty-copy">
          Enter 또는 검색 버튼을 누를 때만 결과를 불러옵니다.
        </p>
      </div>
    );
  }

  if (status === "loading" && !hasResults) {
    return (
      <div className="status-box" role="status">
        <p>
          <strong>{submittedQuery}</strong> 검색 결과를 불러오는 중입니다.
        </p>
      </div>
    );
  }

  if (status === "error" && !hasResults) {
    return (
      <div className="status-box status-box-error" role="alert">
        <p>{error ?? "검색 요청에 실패했습니다."}</p>
        <button className="secondary-button" type="button" onClick={onRetry}>
          다시 시도
        </button>
      </div>
    );
  }

  if (status === "success" && results.length === 0) {
    const visibleSuggestions = suggestions.slice(0, 5);

    return (
      <div className="empty-state">
        <p className="empty-title">
          &quot;{successfulQuery}&quot; 검색 결과가 없습니다.
        </p>
        <p className="empty-copy">
          다른 표기나 더 긴 검색어로 다시 검색하세요.
        </p>
        {visibleSuggestions.length > 0 ? (
          <div className="suggestion-panel" aria-label="유사 검색어">
            <p className="suggestion-title">유사 검색어</p>
            <div className="suggestion-list">
              {visibleSuggestions.map((suggestion) => (
                <button
                  className="suggestion-button"
                  key={suggestion}
                  type="button"
                  onClick={() => onSearchSuggestion(suggestion)}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <>
      {status === "loading" ? (
        <div className="inline-status" role="status">
          <span>{submittedQuery} 검색 중입니다.</span>
          <span>기존 결과를 유지합니다.</span>
        </div>
      ) : null}
      {status === "error" ? (
        <div className="inline-status inline-status-error" role="alert">
          <span>{error ?? "검색 요청에 실패했습니다."}</span>
          <button className="link-button" type="button" onClick={onRetry}>
            다시 시도
          </button>
        </div>
      ) : null}
      <div className="results-summary">
        <span>{successfulQuery}</span>
        <span>{results.length}곡</span>
        {successfulProviderName === undefined ? null : (
          <span>{successfulProviderName}</span>
        )}
      </div>
      <ul className="result-list">
        {results.map((item) => (
          <SearchResultCard
            key={item.song.id}
            item={item}
            providers={providers}
            selectedProviderId={selectedProviderId}
            isExpanded={expandedSongIds.has(item.song.id)}
            isFavorite={favoriteSongIds.has(item.song.id)}
            isFavoritePending={pendingFavoriteSongIds.has(item.song.id)}
            onToggleExpanded={() => onToggleExpanded(item.song.id)}
            onToggleFavorite={() => onToggleFavorite(item.song.id)}
          />
        ))}
      </ul>
    </>
  );
}
