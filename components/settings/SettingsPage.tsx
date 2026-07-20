"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState
} from "react";
import { useOptionalAuth } from "@/components/auth/AuthProvider";
import { fetchProviders, selectInitialProvider } from "@/lib/api/search-ui";
import {
  bootstrapDefaultProvider,
  saveDefaultProviderSelectionLocally,
  syncDefaultProviderSelectionResult
} from "@/lib/preferences/default-provider-client";
import type { ProviderListItem } from "@/lib/providers/providers";

type RequestStatus = "idle" | "loading" | "success" | "error";

export function SettingsPage() {
  const auth = useOptionalAuth();
  const authRef = useRef(auth);
  useLayoutEffect(() => {
    authRef.current = auth;
  }, [auth]);
  const [providers, setProviders] = useState<ProviderListItem[]>([]);
  const [providersStatus, setProvidersStatus] =
    useState<RequestStatus>("loading");
  const [providersError, setProvidersError] = useState<string | null>(null);
  const [preferenceStatus, setPreferenceStatus] =
    useState<RequestStatus>("idle");
  const [preferenceError, setPreferenceError] = useState<string | null>(null);
  const [selectedProviderId, setSelectedProviderId] = useState<
    string | undefined
  >();
  const [savePending, setSavePending] = useState(false);
  const providerRequestVersion = useRef(0);
  const activeProviderRequest = useRef<AbortController | null>(null);
  const preferenceRequestVersion = useRef(0);
  const selectionVersion = useRef(0);
  const [persistenceMode, setPersistenceMode] = useState<
    "authenticated" | "guest" | "unavailable" | "unknown"
  >("unknown");

  const loadPreference = useCallback(
    async (items: ProviderListItem[]): Promise<void> => {
      const authStatus = authRef.current?.state.status;
      if (authStatus === "loading") {
        return;
      }

      const requestVersion = preferenceRequestVersion.current + 1;
      preferenceRequestVersion.current = requestVersion;
      const currentSelectionVersion = selectionVersion.current;
      const expectedAuthIdentity = authIdentity(authRef.current);
      setPreferenceStatus("loading");
      setPreferenceError(null);

      const result = await bootstrapDefaultProvider({
        providers: items,
        ...(authStatus === undefined ? {} : { authStatus }),
        shouldApplyStorageMutation: () =>
          preferenceRequestVersion.current === requestVersion &&
          selectionVersion.current === currentSelectionVersion &&
          authIdentity(authRef.current) === expectedAuthIdentity
      });
      if (
        preferenceRequestVersion.current !== requestVersion ||
        selectionVersion.current !== currentSelectionVersion ||
        authIdentity(authRef.current) !== expectedAuthIdentity
      ) {
        return;
      }

      setPersistenceMode(result.mode);
      if (
        authRef.current?.state.status === "authenticated" &&
        result.mode === "guest"
      ) {
        authRef.current.markExpired();
      }
      if (selectionVersion.current === currentSelectionVersion) {
        setSelectedProviderId(result.selectedProviderId);
      }

      if (result.mode === "unavailable" || result.serverSync === "failed") {
        setPreferenceStatus("error");
        setPreferenceError(
          result.serverSync === "failed"
            ? "로컬 설정은 유지했지만 서버 기본 제공사와 동기화하지 못했습니다."
            : "기본 제공사 설정을 불러오지 못했습니다. 로컬 설정은 유지됩니다."
        );
      } else {
        setPreferenceStatus("success");
      }
    },
    []
  );

  const loadProviders = useCallback(async (): Promise<void> => {
    const requestVersion = providerRequestVersion.current + 1;
    providerRequestVersion.current = requestVersion;
    activeProviderRequest.current?.abort();
    const controller = new AbortController();
    activeProviderRequest.current = controller;
    setProvidersStatus("loading");
    setProvidersError(null);

    try {
      const items = await fetchProviders(fetch, { signal: controller.signal });
      if (providerRequestVersion.current !== requestVersion) {
        return;
      }
      setProviders(items);
      setProvidersStatus("success");
      setSelectedProviderId(
        (current) => current ?? selectInitialProvider(items)
      );
      if (authRef.current === null) {
        await loadPreference(items);
      }
    } catch (error) {
      if (providerRequestVersion.current !== requestVersion) {
        return;
      }
      setProviders([]);
      setProvidersStatus("error");
      setProvidersError(
        error instanceof Error
          ? error.message
          : "제공사 목록을 불러오지 못했습니다."
      );
      setPreferenceStatus("idle");
    } finally {
      if (activeProviderRequest.current === controller) {
        activeProviderRequest.current = null;
      }
    }
  }, [loadPreference]);

  useEffect(() => {
    queueMicrotask(() => void loadProviders());
    return () => {
      providerRequestVersion.current += 1;
      preferenceRequestVersion.current += 1;
      selectionVersion.current += 1;
      activeProviderRequest.current?.abort();
      activeProviderRequest.current = null;
    };
  }, [loadProviders]);

  const authStatus = auth?.state.status;
  const authUserId =
    auth?.state.status === "authenticated" ? auth.state.user.id : undefined;
  const hasSharedAuth = auth !== null;

  useEffect(() => {
    if (
      !hasSharedAuth ||
      authStatus === undefined ||
      authStatus === "loading" ||
      providers.length === 0
    ) {
      return;
    }
    selectionVersion.current += 1;
    queueMicrotask(() => {
      setSavePending(false);
      void loadPreference(providers);
    });
  }, [authStatus, authUserId, hasSharedAuth, loadPreference, providers]);

  async function handleProviderChange(providerId: string): Promise<void> {
    if (savePending) {
      return;
    }

    selectionVersion.current += 1;
    const requestVersion = selectionVersion.current;
    setSelectedProviderId(providerId);
    setPreferenceError(null);
    saveDefaultProviderSelectionLocally(providerId);

    const authState = authRef.current?.state.status;
    if (authState !== "authenticated") {
      setPersistenceMode(authState === "unavailable" ? "unavailable" : "guest");
      setPreferenceStatus(authState === "unavailable" ? "error" : "success");
      setPreferenceError(
        authState === "unavailable"
          ? "인증 상태를 확인할 수 없어 로컬 설정만 보관했습니다."
          : null
      );
      return;
    }

    setSavePending(true);
    setPreferenceStatus("loading");
    const expectedAuthIdentity = authIdentity(authRef.current);
    let result: "succeeded" | "guest" | "unavailable";
    try {
      result = await syncDefaultProviderSelectionResult({
        providerId,
        shouldApplyStorageMutation: () =>
          selectionVersion.current === requestVersion &&
          authIdentity(authRef.current) === expectedAuthIdentity
      });
    } finally {
      setSavePending(false);
    }
    if (
      selectionVersion.current !== requestVersion ||
      authIdentity(authRef.current) !== expectedAuthIdentity
    ) {
      return;
    }

    if (result === "succeeded") {
      setPersistenceMode("authenticated");
      setPreferenceStatus("success");
      return;
    }
    if (result === "guest") {
      authRef.current?.markExpired();
      setPersistenceMode("guest");
    }
    setPreferenceStatus("error");
    setPreferenceError(
      result === "guest"
        ? "세션이 만료되어 선택을 로컬에 보관했습니다. 다시 로그인해 주세요."
        : "서버에 기본 제공사를 저장하지 못했습니다. 로컬 선택은 유지됩니다."
    );
  }

  return (
    <main className="search-shell">
      <div className="mobile-frame">
        <section className="settings-hero" aria-labelledby="settings-title">
          <p className="eyebrow">KaraokeNumberFinder</p>
          <h1 id="settings-title">설정</h1>
          <p className="settings-description">
            검색에 먼저 사용할 노래방 제공사를 선택하세요.
          </p>
        </section>

        <section className="settings-section" aria-live="polite">
          <h2>기본 제공사</h2>
          {providersStatus === "loading" ? (
            <p className="form-note" role="status">
              제공사 목록을 불러오는 중입니다.
            </p>
          ) : null}
          {providersStatus === "error" ? (
            <div className="status-box status-box-error" role="alert">
              <p>{providersError}</p>
              <button
                className="secondary-button"
                type="button"
                onClick={() => void loadProviders()}
              >
                제공사 다시 시도
              </button>
            </div>
          ) : null}
          {providersStatus === "success" ? (
            <label className="settings-field" htmlFor="settings-provider">
              <span className="field-label">제공사</span>
              <select
                id="settings-provider"
                className="provider-select"
                value={selectedProviderId ?? ""}
                disabled={providers.length === 0 || savePending}
                onChange={(event) =>
                  void handleProviderChange(event.target.value)
                }
              >
                {providers.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {preferenceStatus === "loading" ? (
            <p className="form-note" role="status">
              기본 제공사 설정을 저장하는 중입니다.
            </p>
          ) : null}
          {preferenceError === null ? null : (
            <div className="form-retry-note form-note-error" role="alert">
              <span>{preferenceError}</span>
              {providers.length === 0 ? null : (
                <button
                  className="link-button"
                  type="button"
                  onClick={() => void loadPreference(providers)}
                >
                  설정 다시 시도
                </button>
              )}
            </div>
          )}
          {preferenceStatus === "success" ? (
            <p className="form-note">
              {persistenceMode === "authenticated"
                ? "계정의 기본 제공사로 저장됩니다."
                : "이 브라우저의 기본 제공사로 저장됩니다."}
            </p>
          ) : null}
        </section>
      </div>
    </main>
  );
}

function authIdentity(auth: ReturnType<typeof useOptionalAuth>): string {
  return auth === null
    ? "standalone"
    : auth.state.status === "authenticated"
      ? `authenticated:${auth.state.user.id}`
      : auth.state.status;
}
