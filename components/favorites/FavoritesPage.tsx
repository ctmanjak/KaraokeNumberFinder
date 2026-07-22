"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState
} from "react";
import { useOptionalAuth } from "@/components/auth/AuthProvider";
import { isCurrentSharedAuthUser } from "@/components/auth/shared-auth-user";
import { useResetAuthNavigationPending } from "@/components/auth/use-reset-auth-navigation-pending";
import {
  createGoogleSignInUrl,
  fetchBrowserAuthState
} from "@/lib/auth/client";
import {
  deleteFavorite,
  fetchFavoritePage,
  isSongNotFoundFavoriteError,
  isUnauthenticatedFavoriteError,
  putFavorite,
  type FavoriteListItem
} from "@/lib/favorites/client";
import {
  clearPendingFavoriteIntent,
  readPendingFavoriteIntent,
  type PendingFavoriteIntent
} from "@/lib/favorites/pending-intent";
import { FavoriteCard } from "./FavoriteCard";

type AuthStatus =
  "loading" | "authenticated" | "guest" | "unavailable" | "expired";
type RequestStatus = "idle" | "loading" | "success" | "error";
type PendingStatus =
  "adding" | "retryable" | "cleanup-error" | "discarded" | "success";

export function FavoritesPage({
  navigateToAuth = (url) => window.location.assign(url)
}: {
  navigateToAuth?: (url: string) => void;
} = {}) {
  const [authStatus, setAuthStatus] = useState<AuthStatus>("loading");
  const [authenticatedUserId, setAuthenticatedUserId] = useState<string | null>(
    null
  );
  const [listStatus, setListStatus] = useState<RequestStatus>("idle");
  const [items, setItems] = useState<FavoriteListItem[]>([]);
  const [itemsOwnerUserId, setItemsOwnerUserId] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadMoreStatus, setLoadMoreStatus] = useState<RequestStatus>("idle");
  const [pendingIntent, setPendingIntent] =
    useState<PendingFavoriteIntent | null>(null);
  const [pendingStatus, setPendingStatus] = useState<PendingStatus | null>(
    null
  );
  const [pendingMessage, setPendingMessage] = useState<string | null>(null);
  const [deletingSongId, setDeletingSongId] = useState<string | null>(null);
  const [deleteFailureSongId, setDeleteFailureSongId] = useState<string | null>(
    null
  );
  const [loginSubmitting, setLoginSubmitting] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const bootstrapVersion = useRef(0);
  const listRequestVersion = useRef(0);
  const loadMoreRequestVersion = useRef(0);
  const pendingIntentVersion = useRef(0);
  const pendingAddSongId = useRef<string | null>(null);
  const authenticatedUserIdRef = useRef<string | null>(null);
  const itemsOwnerUserIdRef = useRef<string | null>(null);
  const sharedAuth = useOptionalAuth();
  const sharedAuthRef = useRef(sharedAuth);

  useResetAuthNavigationPending(setLoginSubmitting);

  useLayoutEffect(() => {
    sharedAuthRef.current = sharedAuth;
  }, [sharedAuth]);

  const loadFirstPage = useCallback(async (): Promise<void> => {
    const expectedUserId = authenticatedUserIdRef.current;
    if (expectedUserId === null) {
      return;
    }

    const requestVersion = listRequestVersion.current + 1;
    listRequestVersion.current = requestVersion;
    setListStatus("loading");
    try {
      const page = await fetchFavoritePage({ limit: 20 });
      if (
        listRequestVersion.current !== requestVersion ||
        authenticatedUserIdRef.current !== expectedUserId ||
        !isCurrentSharedAuthUser(sharedAuthRef.current, expectedUserId)
      ) {
        return;
      }
      setItems(page.items);
      itemsOwnerUserIdRef.current = expectedUserId;
      setItemsOwnerUserId(expectedUserId);
      setNextCursor(page.next_cursor);
      setListStatus("success");
    } catch (error) {
      if (listRequestVersion.current !== requestVersion) {
        return;
      }
      if (isUnauthenticatedFavoriteError(error)) {
        sharedAuthRef.current?.markExpired();
        setAuthStatus("expired");
        setListStatus("idle");
        setItems([]);
        itemsOwnerUserIdRef.current = null;
        setItemsOwnerUserId(null);
        setNextCursor(null);
      } else {
        setListStatus("error");
      }
    }
  }, []);

  const addPendingFavorite = useCallback(
    async (
      intent: PendingFavoriteIntent
    ): Promise<"complete" | "expired" | "retryable"> => {
      if (pendingAddSongId.current === intent.song_id) {
        return "retryable";
      }

      pendingAddSongId.current = intent.song_id;
      const requestVersion = pendingIntentVersion.current + 1;
      pendingIntentVersion.current = requestVersion;
      setPendingIntent(intent);
      setPendingStatus("adding");
      setPendingMessage("로그인 전에 선택한 곡을 추가하는 중입니다.");

      try {
        await putFavorite(intent.song_id);
        if (pendingIntentVersion.current !== requestVersion) {
          return "retryable";
        }
        if (!clearPendingFavoriteIntent()) {
          setPendingStatus("cleanup-error");
          setPendingMessage(
            "곡은 추가했지만 저장된 자동 추가 요청을 정리하지 못했습니다. 저장소 설정을 확인하고 다시 정리해 주세요."
          );
          return "complete";
        }
        setPendingIntent(null);
        setPendingStatus("success");
        setPendingMessage("로그인 전에 선택한 곡을 즐겨찾기에 추가했습니다.");
        return "complete";
      } catch (error) {
        if (pendingIntentVersion.current !== requestVersion) {
          return "retryable";
        }
        if (isUnauthenticatedFavoriteError(error)) {
          sharedAuthRef.current?.markExpired();
          setAuthStatus("expired");
          setPendingStatus("retryable");
          setPendingMessage(
            "세션이 만료되어 선택한 곡을 아직 추가하지 못했습니다. 다시 로그인해 주세요."
          );
          return "expired";
        } else if (isSongNotFoundFavoriteError(error)) {
          if (!clearPendingFavoriteIntent()) {
            setPendingStatus("cleanup-error");
            setPendingMessage(
              "선택한 곡을 찾을 수 없고 저장된 자동 추가 요청도 정리하지 못했습니다. 저장소 설정을 확인하고 다시 정리해 주세요."
            );
            return "complete";
          }
          setPendingIntent(null);
          setPendingStatus("discarded");
          setPendingMessage(
            "선택한 곡을 찾을 수 없어 자동 추가를 취소했습니다."
          );
          return "complete";
        } else {
          setPendingStatus("retryable");
          setPendingMessage(
            "선택한 곡을 아직 추가하지 못했습니다. 다시 시도하거나 취소할 수 있습니다."
          );
          return "retryable";
        }
      } finally {
        pendingAddSongId.current = null;
      }
    },
    []
  );

  const bootstrap = useCallback(async (): Promise<void> => {
    const requestVersion = bootstrapVersion.current + 1;
    bootstrapVersion.current = requestVersion;
    listRequestVersion.current += 1;
    loadMoreRequestVersion.current += 1;
    pendingIntentVersion.current += 1;
    setAuthStatus("loading");
    setLoginError(null);

    const authContext = sharedAuthRef.current;
    const auth =
      authContext === null ? await fetchBrowserAuthState() : authContext.state;
    if (bootstrapVersion.current !== requestVersion) {
      return;
    }

    if (auth.status === "loading") {
      return;
    }

    if (auth.status !== "authenticated") {
      authenticatedUserIdRef.current = null;
      setAuthenticatedUserId(null);
      setAuthStatus(auth.status);
      setListStatus("idle");
      setItems([]);
      itemsOwnerUserIdRef.current = null;
      setItemsOwnerUserId(null);
      setNextCursor(null);
      setLoadMoreStatus("idle");
      setDeletingSongId(null);
      setDeleteFailureSongId(null);
      return;
    }

    authenticatedUserIdRef.current = auth.user.id;
    setAuthenticatedUserId(auth.user.id);
    if (itemsOwnerUserIdRef.current !== auth.user.id) {
      setItems([]);
      itemsOwnerUserIdRef.current = null;
      setItemsOwnerUserId(null);
      setNextCursor(null);
      setLoadMoreStatus("idle");
      setDeletingSongId(null);
      setDeleteFailureSongId(null);
    }
    setAuthStatus("authenticated");
    const intent = readPendingFavoriteIntent();
    if (intent !== null) {
      const pendingResult = await addPendingFavorite(intent);
      if (bootstrapVersion.current !== requestVersion) {
        return;
      }
      if (pendingResult === "expired") {
        return;
      }
    }

    await loadFirstPage();
  }, [addPendingFavorite, loadFirstPage]);

  useEffect(() => {
    if (sharedAuthRef.current === null) {
      queueMicrotask(() => void bootstrap());
    }
    return () => {
      bootstrapVersion.current += 1;
      listRequestVersion.current += 1;
      loadMoreRequestVersion.current += 1;
      pendingIntentVersion.current += 1;
    };
  }, [bootstrap]);

  const sharedAuthStatus = sharedAuth?.state.status;
  const sharedAuthUserId =
    sharedAuth?.state.status === "authenticated"
      ? sharedAuth.state.user.id
      : undefined;
  const hasSharedAuth = sharedAuth !== null;

  useEffect(() => {
    if (
      !hasSharedAuth ||
      sharedAuthStatus === undefined ||
      sharedAuthStatus === "loading"
    ) {
      return;
    }
    queueMicrotask(() => void bootstrap());
  }, [bootstrap, hasSharedAuth, sharedAuthStatus, sharedAuthUserId]);

  const effectiveAuthStatus = sharedAuth?.state.status ?? authStatus;
  const effectiveAuthenticatedUserId =
    sharedAuth?.state.status === "authenticated"
      ? sharedAuth.state.user.id
      : sharedAuth === null && effectiveAuthStatus === "authenticated"
        ? authenticatedUserId
        : null;
  const visibleItems =
    itemsOwnerUserId === effectiveAuthenticatedUserId ? items : [];
  const visibleNextCursor =
    itemsOwnerUserId === effectiveAuthenticatedUserId ? nextCursor : null;

  async function handleLoadMore(): Promise<void> {
    const expectedUserId = effectiveAuthenticatedUserId;
    if (
      expectedUserId === null ||
      visibleNextCursor === null ||
      loadMoreStatus === "loading"
    ) {
      return;
    }

    const requestVersion = loadMoreRequestVersion.current + 1;
    loadMoreRequestVersion.current = requestVersion;
    setLoadMoreStatus("loading");
    try {
      const page = await fetchFavoritePage({
        cursor: visibleNextCursor,
        limit: 20
      });
      if (
        loadMoreRequestVersion.current !== requestVersion ||
        authenticatedUserIdRef.current !== expectedUserId ||
        !isCurrentSharedAuthUser(sharedAuthRef.current, expectedUserId)
      ) {
        return;
      }
      setItems((current) => {
        const seen = new Set(current.map((item) => item.song_id));
        return [
          ...current,
          ...page.items.filter((item) => !seen.has(item.song_id))
        ];
      });
      setNextCursor(page.next_cursor);
      setLoadMoreStatus("success");
    } catch (error) {
      if (loadMoreRequestVersion.current !== requestVersion) {
        return;
      }
      if (isUnauthenticatedFavoriteError(error)) {
        sharedAuthRef.current?.markExpired();
        setAuthStatus("expired");
        setItems([]);
        itemsOwnerUserIdRef.current = null;
        setItemsOwnerUserId(null);
        setNextCursor(null);
      }
      setLoadMoreStatus("error");
    }
  }

  async function handleDelete(songId: string): Promise<void> {
    if (deletingSongId !== null) {
      return;
    }

    const index = visibleItems.findIndex((item) => item.song_id === songId);
    const item = visibleItems[index];
    if (item === undefined) {
      return;
    }

    setDeletingSongId(songId);
    const operationVersion = bootstrapVersion.current;
    setDeleteFailureSongId(null);
    setItems((current) => current.filter((entry) => entry.song_id !== songId));

    try {
      await deleteFavorite(songId);
    } catch (error) {
      if (bootstrapVersion.current !== operationVersion) {
        return;
      }
      setItems((current) => {
        if (current.some((entry) => entry.song_id === songId)) {
          return current;
        }

        const next = [...current];
        next.splice(Math.min(index, next.length), 0, item);
        return next;
      });
      setDeleteFailureSongId(songId);
      if (isUnauthenticatedFavoriteError(error)) {
        sharedAuthRef.current?.markExpired();
        setAuthStatus("expired");
        setItems([]);
        itemsOwnerUserIdRef.current = null;
        setItemsOwnerUserId(null);
        setNextCursor(null);
      }
    } finally {
      setDeletingSongId(null);
    }
  }

  async function handleRetryPending(): Promise<void> {
    const intent = readPendingFavoriteIntent();
    if (intent === null) {
      setPendingIntent(null);
      setPendingStatus("discarded");
      setPendingMessage("자동 추가 요청이 만료되었거나 취소되었습니다.");
      return;
    }

    await addPendingFavorite(intent);
    await loadFirstPage();
  }

  function handleCancelPending(): void {
    if (!clearPendingFavoriteIntent()) {
      setPendingStatus("cleanup-error");
      setPendingMessage(
        "저장된 자동 추가 요청을 취소하지 못했습니다. 브라우저 저장소 설정을 확인하고 다시 정리해 주세요."
      );
      return;
    }
    setPendingIntent(null);
    setPendingStatus("discarded");
    setPendingMessage("로그인 전에 선택한 곡의 자동 추가를 취소했습니다.");
  }

  function handleRetryPendingCleanup(): void {
    if (!clearPendingFavoriteIntent()) {
      setPendingMessage(
        "저장된 자동 추가 요청을 정리하지 못했습니다. 브라우저 저장소 설정을 확인하고 다시 시도해 주세요."
      );
      return;
    }

    setPendingIntent(null);
    setPendingStatus("success");
    setPendingMessage("저장된 자동 추가 요청을 정리했습니다.");
  }

  async function handleLogin(): Promise<void> {
    if (loginSubmitting) {
      return;
    }

    setLoginSubmitting(true);
    setLoginError(null);
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

  return (
    <main className="search-shell">
      <div className="mobile-frame">
        <header className="favorites-hero">
          <p className="eyebrow">KaraokeNumberFinder</p>
          <h1>즐겨찾기</h1>
        </header>

        <section className="favorites-section" aria-live="polite">
          {effectiveAuthStatus === "loading" ? (
            <StatusBox
              role="status"
              message="로그인 상태를 확인하는 중입니다."
            />
          ) : null}

          {effectiveAuthStatus === "guest" ? (
            <LoginState
              title="로그인이 필요합니다"
              message="즐겨찾기는 로그인한 사용자에게만 저장됩니다."
              error={loginError}
              isSubmitting={loginSubmitting}
              onLogin={() => void handleLogin()}
            />
          ) : null}

          {effectiveAuthStatus === "unavailable" ? (
            <div className="status-box status-box-error" role="alert">
              <p>인증 시스템에 일시적으로 연결할 수 없습니다.</p>
              <button
                className="secondary-button"
                type="button"
                onClick={() => void bootstrap()}
              >
                다시 확인
              </button>
            </div>
          ) : null}

          {effectiveAuthStatus === "expired" ? (
            <LoginState
              title="세션이 만료되었습니다"
              message="다시 로그인하면 남아 있는 자동 추가 요청을 이어서 처리합니다."
              error={loginError}
              isSubmitting={loginSubmitting}
              onLogin={() => void handleLogin()}
            />
          ) : null}

          {effectiveAuthStatus === "authenticated" ? (
            <>
              {pendingMessage === null ? null : (
                <div
                  className={
                    pendingStatus === "retryable" ||
                    pendingStatus === "cleanup-error" ||
                    pendingStatus === "discarded"
                      ? "inline-status inline-status-error"
                      : "inline-status"
                  }
                  role={pendingStatus === "adding" ? "status" : "alert"}
                >
                  <span>{pendingMessage}</span>
                  {pendingStatus === "retryable" && pendingIntent !== null ? (
                    <div className="inline-actions">
                      <button
                        className="link-button"
                        type="button"
                        onClick={() => void handleRetryPending()}
                      >
                        다시 시도
                      </button>
                      <button
                        className="link-button"
                        type="button"
                        onClick={handleCancelPending}
                      >
                        취소
                      </button>
                    </div>
                  ) : null}
                  {pendingStatus === "cleanup-error" &&
                  pendingIntent !== null ? (
                    <div className="inline-actions">
                      <button
                        className="link-button"
                        type="button"
                        onClick={handleRetryPendingCleanup}
                      >
                        다시 정리
                      </button>
                    </div>
                  ) : null}
                </div>
              )}

              {deleteFailureSongId === null ? null : (
                <div className="inline-status inline-status-error" role="alert">
                  <span>삭제에 실패해 항목과 순서를 복구했습니다.</span>
                  <button
                    className="link-button"
                    type="button"
                    onClick={() => void handleDelete(deleteFailureSongId)}
                  >
                    다시 시도
                  </button>
                </div>
              )}

              {listStatus === "loading" ? (
                <StatusBox
                  role="status"
                  message="즐겨찾기를 불러오는 중입니다."
                />
              ) : null}
              {listStatus === "error" ? (
                <div className="status-box status-box-error" role="alert">
                  <p>즐겨찾기 목록을 불러오지 못했습니다.</p>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => void loadFirstPage()}
                  >
                    다시 시도
                  </button>
                </div>
              ) : null}
              {listStatus === "success" && visibleItems.length === 0 ? (
                <div className="empty-state">
                  <p className="empty-title">아직 즐겨찾기가 없습니다.</p>
                  <p className="empty-copy">
                    검색 결과의 별 버튼을 눌러 곡을 추가해 보세요.
                  </p>
                </div>
              ) : null}
              {visibleItems.length > 0 ? (
                <ul className="result-list" aria-label="즐겨찾기 목록">
                  {visibleItems.map((item) => (
                    <FavoriteCard
                      key={item.song_id}
                      item={item}
                      isDeleting={deletingSongId === item.song_id}
                      onDelete={() => void handleDelete(item.song_id)}
                    />
                  ))}
                </ul>
              ) : null}

              {visibleNextCursor === null ? null : (
                <div className="load-more-panel">
                  {loadMoreStatus === "error" ? (
                    <p className="form-note form-note-error" role="alert">
                      다음 즐겨찾기를 불러오지 못했습니다.
                    </p>
                  ) : null}
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={loadMoreStatus === "loading"}
                    onClick={() => void handleLoadMore()}
                  >
                    {loadMoreStatus === "loading" ? "불러오는 중" : "더 보기"}
                  </button>
                </div>
              )}
            </>
          ) : null}
        </section>
      </div>
    </main>
  );
}

function StatusBox({
  message,
  role
}: Readonly<{ message: string; role: "status" }>) {
  return (
    <div className="status-box" role={role}>
      <p>{message}</p>
    </div>
  );
}

function LoginState({
  title,
  message,
  error,
  isSubmitting,
  onLogin
}: Readonly<{
  title: string;
  message: string;
  error: string | null;
  isSubmitting: boolean;
  onLogin: () => void;
}>) {
  return (
    <div className="empty-state login-state">
      <p className="empty-title">{title}</p>
      <p className="empty-copy">{message}</p>
      {error === null ? null : (
        <p className="form-note form-note-error" role="alert">
          {error}
        </p>
      )}
      <button
        className="secondary-button"
        type="button"
        disabled={isSubmitting}
        onClick={onLogin}
      >
        {isSubmitting ? "로그인 준비 중" : "Google로 로그인"}
      </button>
    </div>
  );
}
