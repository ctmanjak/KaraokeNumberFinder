"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import {
  fetchBrowserAuthState,
  signOutBrowserSession,
  type BrowserAuthState,
  type BrowserAuthUser
} from "@/lib/auth/client";

export type AuthState =
  | Readonly<{ status: "loading" | "guest" | "unavailable" | "expired" }>
  | Readonly<{ status: "authenticated"; user: BrowserAuthUser }>;

export type AuthContextValue = Readonly<{
  state: AuthState;
  refresh: () => Promise<void>;
  markExpired: () => void;
  signOut: () => Promise<void>;
  signOutPending: boolean;
  signOutError: string | null;
}>;

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [state, setState] = useState<AuthState>({ status: "loading" });
  const [signOutPending, setSignOutPending] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const requestVersion = useRef(0);
  const mounted = useRef(true);
  const signOutPendingRef = useRef(false);

  const refresh = useCallback(async (): Promise<void> => {
    if (!mounted.current) {
      return;
    }
    const version = requestVersion.current + 1;
    requestVersion.current = version;
    setState({ status: "loading" });

    const result = await fetchBrowserAuthState();
    if (!mounted.current || requestVersion.current !== version) {
      return;
    }
    setState(toSharedAuthState(result));
  }, []);

  const markExpired = useCallback((): void => {
    requestVersion.current += 1;
    setState({ status: "expired" });
  }, []);

  const signOut = useCallback(async (): Promise<void> => {
    if (signOutPendingRef.current) {
      return;
    }

    signOutPendingRef.current = true;
    const version = requestVersion.current + 1;
    requestVersion.current = version;
    setSignOutPending(true);
    setSignOutError(null);

    try {
      await signOutBrowserSession();
      if (mounted.current && requestVersion.current === version) {
        setState({ status: "guest" });
      }
    } catch {
      const verifiedState = await fetchBrowserAuthState();
      if (!mounted.current || requestVersion.current !== version) {
        return;
      }

      setState(toSharedAuthState(verifiedState));
      if (verifiedState.status !== "guest") {
        setSignOutError(
          "로그아웃 상태를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요."
        );
      }
    } finally {
      signOutPendingRef.current = false;
      if (mounted.current) {
        setSignOutPending(false);
      }
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    queueMicrotask(() => void refresh());
    return () => {
      mounted.current = false;
      requestVersion.current += 1;
    };
  }, [refresh]);

  const value = useMemo<AuthContextValue>(
    () => ({
      state,
      refresh,
      markExpired,
      signOut,
      signOutPending,
      signOutError
    }),
    [markExpired, refresh, signOut, signOutError, signOutPending, state]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (value === null) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return value;
}

export function useOptionalAuth(): AuthContextValue | null {
  return useContext(AuthContext);
}

function toSharedAuthState(state: BrowserAuthState): AuthState {
  return state.status === "authenticated"
    ? { status: "authenticated", user: state.user }
    : { status: state.status };
}
