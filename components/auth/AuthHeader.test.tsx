// @vitest-environment jsdom

import {
  act,
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
    vi.useRealTimers();
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

  it("restores the login button after returning from Google", async () => {
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
    expect(
      (screen.getByRole("button", { name: "준비 중" }) as HTMLButtonElement)
        .disabled
    ).toBe(true);

    fireEvent(window, new Event("pageshow"));

    expect(
      (
        screen.getByRole("button", {
          name: "Google 로그인"
        }) as HTMLButtonElement
      ).disabled
    ).toBe(false);
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
    const favoritesLink = screen.getByRole("link", { name: "즐겨찾기" });
    expect(favoritesLink.closest("nav")?.getAttribute("aria-label")).toBe(
      "주요 메뉴"
    );

    fireEvent.click(menuButton);
    expect(menuButton.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getAllByRole("link", { name: "즐겨찾기" })).toHaveLength(1);
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

  it("prefetches catalog access once before an admin opens the menu", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          user: { id: "admin-a", name: "Admin", is_admin: true }
        })
      )
      .mockResolvedValueOnce(jsonResponse({ enabled: true }));
    vi.stubGlobal("fetch", fetcher);

    renderHeader();
    const menuButton = await screen.findByRole("button", {
      name: "Admin 사용자 메뉴"
    });
    await waitFor(() => expect(catalogAccessCalls(fetcher)).toHaveLength(1));
    expect(screen.queryByRole("link", { name: "노래 관리" })).toBeNull();

    fireEvent.click(menuButton);
    expect(screen.getByRole("link", { name: "노래 관리" })).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "노래 관리" }).getAttribute("href")
    ).toBe("/admin/songs");
    expect(fetcher).toHaveBeenCalledWith(
      "/api/admin/catalog-access",
      expect.objectContaining({ cache: "no-store" })
    );
    expect(catalogAccessCalls(fetcher)).toHaveLength(1);
  });

  it("keeps one in-flight access request while the admin toggles the menu", async () => {
    const accessResponse = deferred<Response>();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          user: { id: "admin-a", name: "Admin", is_admin: true }
        })
      )
      .mockImplementationOnce(() => accessResponse.promise);
    vi.stubGlobal("fetch", fetcher);

    renderHeader();
    const menuButton = await screen.findByRole("button", {
      name: "Admin 사용자 메뉴"
    });
    await waitFor(() => expect(catalogAccessCalls(fetcher)).toHaveLength(1));

    fireEvent.click(menuButton);
    fireEvent.click(menuButton);
    fireEvent.click(menuButton);
    expect(catalogAccessCalls(fetcher)).toHaveLength(1);
    expect(screen.queryByRole("link", { name: "노래 관리" })).toBeNull();

    await act(async () => {
      accessResponse.resolve(jsonResponse({ enabled: true }));
      await Promise.resolve();
    });
    expect(screen.getByRole("link", { name: "노래 관리" })).toBeTruthy();
    expect(catalogAccessCalls(fetcher)).toHaveLength(1);
  });

  it("does not render the catalog entry for an admin when the feature is off", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          user: { id: "admin-a", name: "Admin", is_admin: true }
        })
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {
            error: {
              code: "ADMIN_CATALOG_NOT_ENABLED",
              message: "Catalog access is unavailable.",
              request_id: "request-off"
            }
          },
          403
        )
      );
    vi.stubGlobal("fetch", fetcher);

    renderHeader();
    const menuButton = await screen.findByRole("button", {
      name: "Admin 사용자 메뉴"
    });
    await waitFor(() => expect(catalogAccessCalls(fetcher)).toHaveLength(1));
    fireEvent.click(menuButton);
    expect(screen.queryByRole("link", { name: "노래 관리" })).toBeNull();
    expect(screen.queryByText(/준비 중/)).toBeNull();
  });

  it("reuses an actor result across menu reopen and client navigation", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          user: { id: "admin-a", name: "Admin", is_admin: true }
        })
      )
      .mockResolvedValueOnce(jsonResponse({ enabled: true }));
    vi.stubGlobal("fetch", fetcher);

    const view = renderHeader();
    const menuButton = await screen.findByRole("button", {
      name: "Admin 사용자 메뉴"
    });
    await waitFor(() => expect(catalogAccessCalls(fetcher)).toHaveLength(1));
    fireEvent.click(menuButton);
    expect(screen.getByRole("link", { name: "노래 관리" })).toBeTruthy();

    fireEvent.click(menuButton);
    fireEvent.click(menuButton);
    expect(screen.getByRole("link", { name: "노래 관리" })).toBeTruthy();
    expect(catalogAccessCalls(fetcher)).toHaveLength(1);

    navigation.pathname = "/favorites";
    window.history.replaceState({}, "", "/favorites");
    view.rerender(headerTree());
    await act(async () => Promise.resolve());
    expect(menuButton.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(menuButton);
    expect(screen.getByRole("link", { name: "노래 관리" })).toBeTruthy();
    expect(catalogAccessCalls(fetcher)).toHaveLength(1);
  });

  it.each([
    ["guest", null],
    ["regular user", { user: { id: "user-a", name: "Alice", is_admin: false } }]
  ])("does not request catalog access for a %s", async (_label, session) => {
    const fetcher = vi.fn().mockResolvedValueOnce(jsonResponse(session));
    vi.stubGlobal("fetch", fetcher);

    renderHeader();
    if (session === null) {
      await screen.findByRole("button", { name: "Google 로그인" });
    } else {
      const menuButton = await screen.findByRole("button", {
        name: "Alice 사용자 메뉴"
      });
      fireEvent.click(menuButton);
    }
    await act(async () => Promise.resolve());

    expect(catalogAccessCalls(fetcher)).toHaveLength(0);
    expect(screen.queryByRole("link", { name: "노래 관리" })).toBeNull();
  });

  it.each([
    [
      "403",
      () =>
        Promise.resolve(
          jsonResponse({ error: { code: "ADMIN_CATALOG_NOT_ENABLED" } }, 403)
        )
    ],
    [
      "5xx",
      () =>
        Promise.resolve(
          jsonResponse({ error: { code: "PERSONALIZATION_UNAVAILABLE" } }, 503)
        )
    ],
    ["network error", () => Promise.reject(new TypeError("offline"))],
    ["malformed response", () => Promise.resolve(malformedJsonResponse())]
  ])("fails closed for an access %s", async (_label, accessResponse) => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          user: { id: "admin-a", name: "Admin", is_admin: true }
        })
      )
      .mockImplementationOnce(accessResponse);
    vi.stubGlobal("fetch", fetcher);

    renderHeader();
    const menuButton = await screen.findByRole("button", {
      name: "Admin 사용자 메뉴"
    });
    await waitFor(() => expect(catalogAccessCalls(fetcher)).toHaveLength(1));
    await act(async () => Promise.resolve());

    fireEvent.click(menuButton);
    expect(screen.queryByRole("link", { name: "노래 관리" })).toBeNull();
  });

  it("aborts and fails closed when catalog access times out", async () => {
    vi.useFakeTimers();
    let accessSignal: AbortSignal | undefined;
    const fetcher = vi.fn(
      (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        if (input.toString() === "/api/auth/get-session") {
          return Promise.resolve(
            jsonResponse({
              user: { id: "admin-a", name: "Admin", is_admin: true }
            })
          );
        }
        accessSignal = init?.signal ?? undefined;
        return new Promise((_resolve, reject) => {
          accessSignal?.addEventListener(
            "abort",
            () => reject(new DOMException("Timed out", "AbortError")),
            { once: true }
          );
        });
      }
    );
    vi.stubGlobal("fetch", fetcher);

    renderHeader();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(
      screen.getByRole("button", { name: "Admin 사용자 메뉴" })
    ).toBeTruthy();
    expect(accessSignal?.aborted).toBe(false);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(8_000);
    });
    expect(accessSignal?.aborted).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Admin 사용자 메뉴" }));
    expect(screen.queryByRole("link", { name: "노래 관리" })).toBeNull();
  });

  it("discards an old actor response and checks the replacement actor", async () => {
    const actorAAccess = deferred<Response>();
    const accessSignals: AbortSignal[] = [];
    let sessionReads = 0;
    let accessReads = 0;
    const fetcher = vi.fn(
      (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        if (input.toString() === "/api/auth/get-session") {
          sessionReads += 1;
          return Promise.resolve(
            jsonResponse({
              user:
                sessionReads === 1
                  ? { id: "admin-a", name: "Admin A", is_admin: true }
                  : { id: "admin-b", name: "Admin B", is_admin: true }
            })
          );
        }
        if (input.toString() === "/api/admin/catalog-access") {
          accessReads += 1;
          if (init?.signal !== undefined && init.signal !== null) {
            accessSignals.push(init.signal);
          }
          return accessReads === 1
            ? actorAAccess.promise
            : Promise.resolve(jsonResponse({ enabled: false }));
        }
        throw new Error(`Unexpected request: ${input.toString()}`);
      }
    );
    vi.stubGlobal("fetch", fetcher);

    renderHeader();
    await screen.findByRole("button", { name: "Admin A 사용자 메뉴" });
    await waitFor(() => expect(catalogAccessCalls(fetcher)).toHaveLength(1));

    fireEvent.click(screen.getByRole("button", { name: "세션 새로고침" }));
    const actorBMenu = await screen.findByRole("button", {
      name: "Admin B 사용자 메뉴"
    });
    await waitFor(() => expect(catalogAccessCalls(fetcher)).toHaveLength(2));
    expect(accessSignals[0]?.aborted).toBe(true);

    await act(async () => {
      actorAAccess.resolve(jsonResponse({ enabled: true }));
      await Promise.resolve();
    });
    fireEvent.click(actorBMenu);
    expect(screen.queryByRole("link", { name: "노래 관리" })).toBeNull();
  });

  it("removes an enabled result after logout", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          user: { id: "admin-a", name: "Admin", is_admin: true }
        })
      )
      .mockResolvedValueOnce(jsonResponse({ enabled: true }))
      .mockResolvedValueOnce(jsonResponse({ success: true }));
    vi.stubGlobal("fetch", fetcher);

    renderHeader();
    const menuButton = await screen.findByRole("button", {
      name: "Admin 사용자 메뉴"
    });
    await waitFor(() => expect(catalogAccessCalls(fetcher)).toHaveLength(1));
    fireEvent.click(menuButton);
    expect(screen.getByRole("link", { name: "노래 관리" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "로그아웃" }));
    await screen.findByRole("button", { name: "Google 로그인" });
    expect(screen.queryByRole("link", { name: "노래 관리" })).toBeNull();
  });

  it("aborts an in-flight access request on unmount without applying it", async () => {
    const accessResponse = deferred<Response>();
    let accessSignal: AbortSignal | undefined;
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          user: { id: "admin-a", name: "Admin", is_admin: true }
        })
      )
      .mockImplementationOnce((_input, init: RequestInit | undefined) => {
        accessSignal = init?.signal ?? undefined;
        return accessResponse.promise;
      });
    vi.stubGlobal("fetch", fetcher);

    const view = renderHeader();
    await screen.findByRole("button", { name: "Admin 사용자 메뉴" });
    await waitFor(() => expect(accessSignal).toBeDefined());

    view.unmount();
    expect(accessSignal?.aborted).toBe(true);
    await act(async () => {
      accessResponse.resolve(jsonResponse({ enabled: true }));
      await Promise.resolve();
    });
    expect(screen.queryByRole("link", { name: "노래 관리" })).toBeNull();
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
  return render(headerTree(navigateToAuth));
}

function headerTree(navigateToAuth = vi.fn()) {
  return (
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

function malformedJsonResponse(): Response {
  return {
    ok: true,
    status: 200,
    json: async () => {
      throw new SyntaxError("Malformed JSON");
    }
  } as unknown as Response;
}

function catalogAccessCalls(fetcher: ReturnType<typeof vi.fn>) {
  return fetcher.mock.calls.filter(
    ([input]) => input.toString() === "/api/admin/catalog-access"
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
