"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createGoogleSignInUrl } from "@/lib/auth/client";
import type { AllowedAuthCallbackPath } from "@/lib/auth/policy";
import { useAuth } from "./AuthProvider";

export function AuthHeader({
  navigateToAuth = (url) => window.location.assign(url)
}: Readonly<{ navigateToAuth?: (url: string) => void }> = {}) {
  const pathname = usePathname();
  const auth = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [loginPending, setLoginPending] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [callbackMessage, setCallbackMessage] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const errorCode = new URLSearchParams(window.location.search).get(
      "auth_error"
    );
    queueMicrotask(() => {
      setMenuOpen(false);
      setLoginError(null);
      setCallbackMessage(authCallbackMessage(errorCode));
    });
  }, [pathname]);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }

    function handleEscape(event: globalThis.KeyboardEvent): void {
      if (event.key === "Escape") {
        event.preventDefault();
        setMenuOpen(false);
        menuButtonRef.current?.focus();
      }
    }

    function handleOutsideInteraction(event: Event): void {
      if (!menuRef.current?.contains(event.target as Node | null)) {
        setMenuOpen(false);
      }
    }

    document.addEventListener("keydown", handleEscape);
    document.addEventListener("pointerdown", handleOutsideInteraction);
    document.addEventListener("focusin", handleOutsideInteraction);
    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.removeEventListener("pointerdown", handleOutsideInteraction);
      document.removeEventListener("focusin", handleOutsideInteraction);
    };
  }, [menuOpen]);

  async function handleLogin(): Promise<void> {
    if (loginPending) {
      return;
    }

    setLoginPending(true);
    setLoginError(null);
    try {
      const url = await createGoogleSignInUrl({
        callbackURL: callbackPath(pathname)
      });
      navigateToAuth(url);
    } catch {
      setLoginError(
        "로그인 요청을 시작하지 못했습니다. 현재 화면은 계속 사용할 수 있습니다."
      );
      setLoginPending(false);
    }
  }

  const displayName =
    auth.state.status === "authenticated"
      ? (auth.state.user.name ?? auth.state.user.email ?? "내 계정")
      : "";

  return (
    <div className="global-header-shell">
      <header className="auth-header" aria-label="전역 탐색">
        <nav className="auth-primary-nav" aria-label="주요 메뉴">
          <Link
            className="brand-link"
            href="/"
            aria-label="KaraokeNumberFinder 홈"
          >
            KNF
          </Link>
          <Link className="header-link" href="/">
            검색
          </Link>
          {auth.state.status === "authenticated" ? null : (
            <Link className="header-link" href="/favorites">
              즐겨찾기
            </Link>
          )}
        </nav>

        <div className="auth-header-account">
          {auth.state.status === "loading" ? (
            <span className="auth-loading" role="status">
              로그인 확인 중
            </span>
          ) : null}

          {auth.state.status === "guest" || auth.state.status === "expired" ? (
            <button
              className="header-login-button"
              type="button"
              disabled={loginPending}
              onClick={() => void handleLogin()}
            >
              {loginPending ? "준비 중" : "Google 로그인"}
            </button>
          ) : null}

          {auth.state.status === "unavailable" ? (
            <button
              className="header-retry-button"
              type="button"
              onClick={() => void auth.refresh()}
            >
              인증 다시 확인
            </button>
          ) : null}

          {auth.state.status === "authenticated" ? (
            <div ref={menuRef} className="user-menu">
              <button
                ref={menuButtonRef}
                className="user-menu-button"
                type="button"
                aria-expanded={menuOpen}
                aria-haspopup="menu"
                aria-controls="global-user-menu"
                aria-label={`${displayName} 사용자 메뉴`}
                onClick={() => setMenuOpen((current) => !current)}
              >
                {displayName}
              </button>
              {menuOpen ? (
                <div id="global-user-menu" className="user-menu-panel">
                  <Link href="/favorites" onClick={() => setMenuOpen(false)}>
                    즐겨찾기
                  </Link>
                  <Link href="/settings" onClick={() => setMenuOpen(false)}>
                    설정
                  </Link>
                  <button
                    type="button"
                    disabled={auth.signOutPending}
                    onClick={() => void auth.signOut()}
                  >
                    {auth.signOutPending ? "로그아웃 중" : "로그아웃"}
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </header>

      {callbackMessage === null ? null : (
        <div className="auth-header-notice" role="status">
          {callbackMessage}
        </div>
      )}
      {auth.state.status === "expired" ? (
        <div className="auth-header-notice" role="status">
          세션이 만료되었습니다. 공개 검색은 계속 사용할 수 있습니다.
        </div>
      ) : null}
      {auth.state.status === "unavailable" ? (
        <div className="auth-header-notice" role="status">
          인증 시스템에 연결할 수 없지만 검색은 계속 사용할 수 있습니다.
        </div>
      ) : null}
      {loginError === null ? null : (
        <div className="auth-header-error" role="alert">
          {loginError}
        </div>
      )}
      {auth.signOutError === null ? null : (
        <div className="auth-header-error" role="alert">
          <span>{auth.signOutError}</span>
          <button type="button" onClick={() => void auth.signOut()}>
            다시 시도
          </button>
        </div>
      )}
    </div>
  );
}

function callbackPath(pathname: string): AllowedAuthCallbackPath {
  return pathname === "/favorites" || pathname === "/settings" ? pathname : "/";
}

function authCallbackMessage(code: string | null): string | null {
  if (code === "ACCOUNT_CONFLICT") {
    return "이 이메일은 다른 계정에 연결되어 있어 로그인할 수 없습니다.";
  }
  if (code === "OAUTH_FAILED") {
    return "Google 로그인이 취소되었거나 완료되지 않았습니다.";
  }
  return null;
}
