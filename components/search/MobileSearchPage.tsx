"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent
} from "react";
import {
  fetchProviders,
  fetchSearchResults,
  selectInitialProvider
} from "@/lib/api/search-ui";
import {
  bootstrapDefaultProvider,
  saveDefaultProviderSelectionLocally,
  syncDefaultProviderSelection,
  type DefaultProviderPersistenceMode
} from "@/lib/preferences/default-provider-client";
import type { ProviderListItem } from "@/lib/providers/providers";
import type { SearchResponse, SearchResultItem } from "@/lib/search/search";
import { SearchResultCard } from "./SearchResultCard";

type RequestState = "idle" | "loading" | "success" | "error";

export function MobileSearchPage() {
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
  const latestSearchRequestId = useRef(0);
  const selectedProviderIdRef = useRef<string | undefined>(undefined);
  const providerSelectionVersion = useRef(0);
  const lastUserSelectedProviderId = useRef<string | undefined>(undefined);
  const preferenceMode = useRef<DefaultProviderPersistenceMode | "unknown">(
    "unknown"
  );
  const preferenceWriteQueue = useRef<Promise<void>>(Promise.resolve());

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
            return;
          }

          const latestProviderId = selectedProviderIdRef.current;
          if (
            result.mode === "authenticated" &&
            latestProviderId !== undefined
          ) {
            persistProviderSelection(latestProviderId, result.mode);
          }
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
      });

    return () => {
      isMounted = false;
    };
  }, [persistProviderSelection, updateSelectedProvider]);

  function handleProviderChange(providerId: string | undefined): void {
    providerSelectionVersion.current += 1;
    lastUserSelectedProviderId.current = providerId;
    updateSelectedProvider(providerId);

    if (providerId !== undefined) {
      persistProviderSelection(providerId);
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

    setSubmittedQuery(trimmedQuery);
    setSubmittedProviderId(providerId);
    const providerName = providers.find(
      (provider) => provider.id === providerId
    )?.name;

    setExpandedSongIds(new Set());
    setSearchStatus("loading");
    setSearchError(null);

    try {
      const response: SearchResponse = await fetchSearchResults({
        query: trimmedQuery,
        providerId
      });

      if (latestSearchRequestId.current !== requestId) {
        return;
      }

      setResults(response.items);
      setSuggestions(response.suggestions);
      setSuccessfulQuery(response.query);
      setSuccessfulProviderName(providerName);
      setSearchStatus("success");
    } catch (error) {
      if (latestSearchRequestId.current !== requestId) {
        return;
      }

      setSearchStatus("error");
      setSearchError(
        error instanceof Error ? error.message : "검색 요청에 실패했습니다."
      );
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

  const canSubmit = query.trim().length > 0 && searchStatus !== "loading";

  return (
    <main className="search-shell">
      <div className="mobile-frame">
        <section className="search-hero" aria-labelledby="page-title">
          <p className="eyebrow">KaraokeNumberFinder</p>
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

        <section className="results-section" aria-live="polite">
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
          />
        </section>
      </div>
    </main>
  );
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
  error,
  onToggleExpanded,
  onRetry,
  onSearchSuggestion
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
  error: string | null;
  onToggleExpanded: (songId: string) => void;
  onRetry: () => void;
  onSearchSuggestion: (suggestion: string) => void;
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
            onToggleExpanded={() => onToggleExpanded(item.song.id)}
          />
        ))}
      </ul>
    </>
  );
}
