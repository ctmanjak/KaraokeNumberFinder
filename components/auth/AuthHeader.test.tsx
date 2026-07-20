// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthHeader } from "./AuthHeader";
import { AuthProvider, useAuth } from "./AuthProvider";

const navigation = vi.hoisted(() => ({ pathname: "/" }));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname
}));

describe("global auth header", () => {
  beforeEach(() => {
    navigation.pathname = "/";
    window.history.replaceState({}, "", "/");
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("renders stable loading, guest, unavailable, and expired states", async () => {
    const firstSession = deferred<Response>();
    const fetcher = vi
      .fn()
      .mockImplementationOnce(() => firstSession.promise)
      .mockResolvedValueOnce(jsonResponse(null));
    vi.stubGlobal("fetch", fetcher);

    renderHeader();
    expect(screen.getByText("로그인 확인 중")).toBeTruthy();

    firstSession.resolve(jsonResponse({ error: {} }, 503));
    expect(
      await screen.findByRole("button", { name: "인증 다시 확인" })
    ).toBeTruthy();
    expect(screen.getByText(/검색은 계속 사용할 수 있습니다/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "인증 다시 확인" }));
    expect(
      await screen.findByRole("button", { name: "Google 로그인" })
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "세션 만료" }));
    expect(screen.getByText(/세션이 만료되었습니다/)).toBeTruthy();
  });

  it("uses the current exact callback without exposing arbitrary auth errors", async () => {
    navigation.pathname = "/settings";
    window.history.replaceState({}, "", "/settings?auth_error=raw-secret");
    const navigateToAuth = vi.fn();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(null))
      .mockResolvedValueOnce(
        jsonResponse({
          url: "https://accounts.google.com/o/oauth2/v2/auth?state=safe",
          redirect: true
        })
      );
    vi.stubGlobal("fetch", fetcher);

    renderHeader(navigateToAuth);
    fireEvent.click(
      await screen.findByRole("button", { name: "Google 로그인" })
    );

    await waitFor(() => expect(navigateToAuth).toHaveBeenCalledOnce());
    expect(fetcher).toHaveBeenCalledWith(
      "/api/auth/sign-in/social",
      expect.objectContaining({
        body: JSON.stringify({ provider: "google", callbackURL: "/settings" })
      })
    );
    expect(screen.queryByText("raw-secret")).toBeNull();
  });

  it("exposes an accessible keyboard menu and signs out", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ user: { id: "user-a", name: "Alice" } })
      )
      .mockResolvedValueOnce(jsonResponse({ success: true }));
    vi.stubGlobal("fetch", fetcher);

    renderHeader();
    const menuButton = await screen.findByRole("button", {
      name: "Alice 사용자 메뉴"
    });
    expect(menuButton.getAttribute("aria-expanded")).toBe("false");
    expect(menuButton.getAttribute("aria-haspopup")).toBe("menu");
    expect(menuButton.getAttribute("aria-controls")).toBe("global-user-menu");

    fireEvent.click(menuButton);
    expect(menuButton.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("link", { name: "설정" })).toBeTruthy();
    const outsideButton = screen.getByRole("button", { name: "세션 만료" });
    fireEvent.pointerDown(outsideButton);
    expect(menuButton.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(menuButton);
    fireEvent.focusIn(outsideButton);
    expect(menuButton.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(menuButton);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(menuButton.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(menuButton);

    fireEvent.click(menuButton);
    fireEvent.click(screen.getByRole("button", { name: "로그아웃" }));
    expect(
      await screen.findByRole("button", { name: "Google 로그인" })
    ).toBeTruthy();
    expect(screen.queryByText("Alice")).toBeNull();
  });

  it("does not let a slow refresh overwrite a completed logout", async () => {
    const slowSession = deferred<Response>();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ user: { id: "user-a", name: "Alice" } })
      )
      .mockImplementationOnce(() => slowSession.promise)
      .mockResolvedValueOnce(jsonResponse({ success: true }));
    vi.stubGlobal("fetch", fetcher);

    renderHeader();
    await screen.findByRole("button", { name: "Alice 사용자 메뉴" });
    fireEvent.click(screen.getByRole("button", { name: "세션 새로고침" }));
    fireEvent.click(screen.getByRole("button", { name: "테스트 로그아웃" }));
    await screen.findByRole("button", { name: "Google 로그인" });

    slowSession.resolve(
      jsonResponse({ user: { id: "stale-user", name: "Stale" } })
    );
    await Promise.resolve();
    expect(screen.queryByText("Stale")).toBeNull();
    expect(screen.getByRole("button", { name: "Google 로그인" })).toBeTruthy();
  });

  it("rechecks state after logout failure and offers a retry", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ user: { id: "user-a", name: "Alice" } })
      )
      .mockResolvedValueOnce(jsonResponse({ error: {} }, 503))
      .mockResolvedValueOnce(
        jsonResponse({ user: { id: "user-a", name: "Alice" } })
      )
      .mockResolvedValueOnce(jsonResponse({ success: true }));
    vi.stubGlobal("fetch", fetcher);

    renderHeader();
    const menuButton = await screen.findByRole("button", {
      name: "Alice 사용자 메뉴"
    });
    fireEvent.click(menuButton);
    fireEvent.click(screen.getByRole("button", { name: "로그아웃" }));
    expect(
      await screen.findByText(/로그아웃 상태를 확인하지 못했습니다/)
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(
      await screen.findByRole("button", { name: "Google 로그인" })
    ).toBeTruthy();
  });

  it("prevents duplicate logout submissions", async () => {
    const signOutResponse = deferred<Response>();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ user: { id: "user-a", name: "Alice" } })
      )
      .mockImplementationOnce(() => signOutResponse.promise);
    vi.stubGlobal("fetch", fetcher);

    renderHeader();
    const menuButton = await screen.findByRole("button", {
      name: "Alice 사용자 메뉴"
    });
    fireEvent.click(menuButton);
    fireEvent.click(screen.getByRole("button", { name: "로그아웃" }));
    fireEvent.click(screen.getByRole("button", { name: "테스트 로그아웃" }));

    expect(
      fetcher.mock.calls.filter(
        ([input]) => input.toString() === "/api/auth/sign-out"
      )
    ).toHaveLength(1);
    signOutResponse.resolve(jsonResponse({ success: true }));
    expect(
      await screen.findByRole("button", { name: "Google 로그인" })
    ).toBeTruthy();
  });
});

function renderHeader(navigateToAuth = vi.fn()) {
  return render(
    <AuthProvider>
      <AuthHeader navigateToAuth={navigateToAuth} />
      <AuthTestControls />
    </AuthProvider>
  );
}

function AuthTestControls() {
  const auth = useAuth();
  return (
    <div>
      <button type="button" onClick={auth.markExpired}>
        세션 만료
      </button>
      <button type="button" onClick={() => void auth.refresh()}>
        세션 새로고침
      </button>
      <button type="button" onClick={() => void auth.signOut()}>
        테스트 로그아웃
      </button>
    </div>
  );
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  } as Response;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
