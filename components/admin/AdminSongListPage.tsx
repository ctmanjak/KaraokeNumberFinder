"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { AdminSongClientError, fetchAdminSongs } from "@/lib/admin-song/client";
import type {
  AdminSongListItem,
  AdminSongProviderSummary
} from "@/lib/admin-song/types";

type ListRequest = Readonly<{
  query: string;
  cursor?: string;
  append: boolean;
}>;

export function AdminSongListPage() {
  const auth = useAuth();
  const activeRequest = useRef<AbortController | null>(null);
  const requestSequence = useRef(0);
  const [queryInput, setQueryInput] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [items, setItems] = useState<readonly AdminSongListItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState<"replace" | "append" | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<AdminSongClientError | null>(null);
  const [failedRequest, setFailedRequest] = useState<ListRequest | null>(null);
  const initialLoadIdentity =
    auth.state.status === "authenticated"
      ? `${auth.state.user.id}:${auth.state.user.is_admin}`
      : auth.state.status;

  useEffect(() => {
    if (auth.state.status !== "authenticated" || !auth.state.user.is_admin) {
      return;
    }

    const controller = new AbortController();
    activeRequest.current = controller;
    const sequence = ++requestSequence.current;
    queueMicrotask(async () => {
      await loadSongs({ query: "", append: false }, controller, sequence);
    });
    return () => {
      controller.abort();
      if (activeRequest.current === controller) {
        activeRequest.current = null;
      }
    };
    // The authenticated administrator identity is the only initial-load trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialLoadIdentity]);

  if (auth.state.status === "loading") {
    return <ListState title="관리자 권한을 확인하는 중입니다." />;
  }
  if (auth.state.status !== "authenticated") {
    return (
      <ListState
        title="로그인이 필요합니다."
        copy="상단의 Google 로그인 버튼으로 관리자 계정에 로그인해 주세요."
      />
    );
  }
  if (!auth.state.user.is_admin) {
    return (
      <ListState
        title="관리자만 접근할 수 있습니다."
        copy="이 계정에는 노래 카탈로그를 관리할 권한이 없습니다."
        error
      />
    );
  }
  if (error?.code === "ADMIN_CATALOG_NOT_ENABLED") {
    return <CatalogNotEnabledState />;
  }
  if (error?.code === "FORBIDDEN") {
    return (
      <ListState
        title="관리자만 접근할 수 있습니다."
        copy="현재 세션의 권한을 다시 확인해 주세요."
        error
      />
    );
  }

  function submitSearch(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const query = queryInput.trim();
    setActiveQuery(query);
    startLoad({ query, append: false });
  }

  function startLoad(request: ListRequest): void {
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    const sequence = ++requestSequence.current;
    void loadSongs(request, controller, sequence);
  }

  async function loadSongs(
    request: ListRequest,
    controller: AbortController,
    sequence: number
  ): Promise<void> {
    setLoading(request.append ? "append" : "replace");
    setError(null);
    if (!request.append) {
      setLoaded(false);
      setItems([]);
      setNextCursor(null);
    }

    try {
      const response = await fetchAdminSongs(
        {
          ...(request.query === "" ? {} : { query: request.query }),
          ...(request.cursor === undefined ? {} : { cursor: request.cursor })
        },
        fetch,
        controller.signal
      );
      if (controller.signal.aborted || sequence !== requestSequence.current) {
        return;
      }
      setItems((current) =>
        request.append ? [...current, ...response.items] : response.items
      );
      setNextCursor(response.next_cursor);
      setLoaded(true);
      setFailedRequest(null);
    } catch (caught) {
      if (controller.signal.aborted || sequence !== requestSequence.current) {
        return;
      }
      const clientError =
        caught instanceof AdminSongClientError
          ? caught
          : new AdminSongClientError("ADMIN_SONG_UNAVAILABLE", undefined);
      setError(clientError);
      setFailedRequest(request);
      setLoaded(true);
      if (clientError.code === "UNAUTHENTICATED") {
        auth.markExpired();
      }
    } finally {
      if (sequence === requestSequence.current) {
        setLoading(null);
      }
      if (activeRequest.current === controller) {
        activeRequest.current = null;
      }
    }
  }

  return (
    <main className="search-shell">
      <div className="mobile-frame admin-frame">
        <section
          className="settings-hero admin-list-hero"
          aria-labelledby="admin-song-list-title"
        >
          <div>
            <p className="eyebrow">Admin</p>
            <h1 id="admin-song-list-title">노래 관리</h1>
            <p className="settings-description">
              제목, 가수 또는 별칭으로 기존 카탈로그를 찾습니다.
            </p>
          </div>
          <Link
            className="secondary-button admin-create-link"
            href="/admin/songs/new"
          >
            새 노래 추가
          </Link>
        </section>

        <form
          className="search-form admin-list-search"
          role="search"
          onSubmit={submitSearch}
        >
          <label className="settings-field" htmlFor="admin-song-query">
            <span className="field-label">카탈로그 검색</span>
            <span className="search-row">
              <input
                id="admin-song-query"
                className="search-input"
                type="search"
                value={queryInput}
                onChange={(event) => setQueryInput(event.target.value)}
                placeholder="원제, 표시 제목, 가수, 별칭"
              />
              <button
                className="search-button"
                type="submit"
                disabled={loading !== null}
              >
                검색
              </button>
            </span>
          </label>
        </form>

        <section
          className="results-section admin-list-results"
          aria-labelledby="admin-song-results-title"
          aria-busy={loading !== null}
        >
          <div className="results-summary">
            <h2 id="admin-song-results-title">검색 결과</h2>
            {loaded && error === null ? (
              <span>
                {activeQuery === "" ? "전체 목록" : `“${activeQuery}”`}
                {" · "}
                {items.length}개 표시
              </span>
            ) : null}
          </div>

          {loading === "replace" ? (
            <div className="status-box" role="status">
              <p>노래 목록을 불러오는 중입니다.</p>
            </div>
          ) : null}

          {error !== null &&
          error.code !== "FORBIDDEN" &&
          error.code !== "ADMIN_CATALOG_NOT_ENABLED" ? (
            <div className="status-box status-box-error" role="alert">
              <p>노래 목록을 불러오지 못했습니다.</p>
              <button
                className="tertiary-button"
                type="button"
                onClick={() => {
                  if (failedRequest !== null) startLoad(failedRequest);
                }}
              >
                다시 시도
              </button>
            </div>
          ) : null}

          {loaded &&
          loading !== "replace" &&
          error === null &&
          items.length === 0 ? (
            <div className="empty-state">
              <p className="empty-title">조건에 맞는 노래가 없습니다.</p>
              <p className="empty-copy">
                다른 제목이나 가수, 별칭으로 검색해 보세요.
              </p>
            </div>
          ) : null}

          {items.length > 0 ? (
            <ul className="admin-song-list">
              {items.map((song) => (
                <li key={song.id}>
                  <Link
                    className="admin-song-list-card"
                    href={`/admin/songs/${encodeURIComponent(song.id)}`}
                  >
                    <div className="admin-song-list-heading">
                      <h3>{song.display_title}</h3>
                      <span className="language-label">
                        {song.original_language}
                      </span>
                    </div>
                    <p className="canonical-title">
                      원제 {song.canonical_title}
                    </p>
                    <p className="artist-name">{song.canonical_artist}</p>
                    <ProviderSummary entries={song.provider_summary} />
                    <p className="admin-song-updated">
                      최근 수정 {formatUpdatedAt(song.updated_at)}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}

          {nextCursor === null || error !== null ? null : (
            <div className="load-more-panel">
              <button
                className="tertiary-button"
                type="button"
                disabled={loading !== null}
                onClick={() =>
                  startLoad({
                    query: activeQuery,
                    cursor: nextCursor,
                    append: true
                  })
                }
              >
                {loading === "append" ? "더 불러오는 중" : "더 보기"}
              </button>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function ProviderSummary({
  entries
}: Readonly<{ entries: readonly AdminSongProviderSummary[] }>) {
  if (entries.length === 0) {
    return <p className="admin-provider-empty">제공사 수록 정보 없음</p>;
  }
  return (
    <ul className="admin-provider-summary" aria-label="제공사 수록 요약">
      {entries.map((entry, index) => (
        <li
          key={`${entry.provider_id}:${entry.version_info}:${entry.karaoke_number}:${index}`}
        >
          <strong>{entry.provider_name}</strong>
          <span>
            {entry.karaoke_number === ""
              ? entry.availability_status
              : entry.karaoke_number}
            {entry.version_info === "" ? "" : ` · ${entry.version_info}`}
          </span>
        </li>
      ))}
    </ul>
  );
}

function ListState({
  title,
  copy,
  error = false
}: Readonly<{ title: string; copy?: string; error?: boolean }>) {
  return (
    <main className="search-shell">
      <div className="mobile-frame">
        <section className="settings-hero">
          <p className="eyebrow">Admin</p>
          <h1>노래 관리</h1>
        </section>
        <div
          className={`status-box${error ? " status-box-error" : ""}`}
          role={error ? "alert" : "status"}
        >
          <p>{title}</p>
          {copy === undefined ? null : <p>{copy}</p>}
        </div>
      </div>
    </main>
  );
}

function CatalogNotEnabledState() {
  return (
    <main className="search-shell">
      <div className="mobile-frame">
        <section className="settings-hero">
          <p className="eyebrow">Admin</p>
          <h1>관리자 카탈로그가 아직 활성화되지 않았습니다</h1>
          <p className="settings-description">
            현재 관리자 카탈로그에 접근할 수 없습니다.
          </p>
        </section>
        <nav className="admin-forbidden-links" aria-label="이동 링크">
          <Link className="secondary-button" href="/">
            홈으로
          </Link>
          <Link className="tertiary-button" href="/">
            공개 검색으로
          </Link>
        </nav>
      </div>
    </main>
  );
}

function formatUpdatedAt(value: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}
