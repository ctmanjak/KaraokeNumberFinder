// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PENDING_FAVORITE_STORAGE_KEY } from "@/lib/favorites/pending-intent";
import { MobileSearchPage } from "./MobileSearchPage";

const googleUrl =
  "https://accounts.google.com/o/oauth2/v2/auth?state=state&code_challenge=challenge";
const provider = {
  id: "provider-a",
  name: "Provider A",
  country: "KR",
  is_active: true,
  display_order: 1,
  is_default: true,
  last_catalog_updated_at: null
};
const searchResponse = {
  query: "sample",
  normalized_query: "sample",
  items: [
    {
      song: {
        id: "song-a",
        original_language: "ja",
        canonical_title: "Sample Canonical",
        display_title: "Sample Display",
        canonical_artist: "Sample Artist",
        release_year: 2026,
        tie_in: null,
        matched_aliases: []
      },
      karaoke_entries: [
        {
          id: "entry-a",
          provider_id: "provider-a",
          karaoke_number: "12345",
          version_info: "",
          availability_status: "available",
          last_verified_at: "2026-07-01",
          is_stale: false
        }
      ],
      distinguishing_labels: ["Sample Artist", "2026"],
      relevance_score: 100
    }
  ],
  next_cursor: null,
  suggestions: []
};

describe("MobileSearchPage favorites", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("prompts a guest without PUT and keeps search state when cancelled", async () => {
    const fetchMock = installFetch({ auth: "guest" });

    render(<MobileSearchPage />);
    await searchForSong();
    await waitForAuthCall(fetchMock);

    fireEvent.click(
      screen.getByRole("button", { name: "Sample Display 즐겨찾기에 추가" })
    );

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(mutationCalls(fetchMock)).toHaveLength(0);
    expect(
      window.sessionStorage.getItem(PENDING_FAVORITE_STORAGE_KEY)
    ).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "취소" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("Sample Display")).toBeTruthy();
    expect((screen.getByLabelText("검색어") as HTMLInputElement).value).toBe(
      "sample"
    );
    fireEvent.click(screen.getByRole("button", { name: "제공사별 비교" }));
    expect(screen.getByLabelText("제공사별 번호 비교")).toBeTruthy();
  });

  it("records one intent only after Google login is selected and uses /favorites", async () => {
    const fetchMock = installFetch({ auth: "guest", login: "success" });
    const navigateToAuth = vi.fn();

    render(<MobileSearchPage navigateToAuth={navigateToAuth} />);
    await searchForSong();
    await waitForAuthCall(fetchMock);
    fireEvent.click(
      screen.getByRole("button", { name: "Sample Display 즐겨찾기에 추가" })
    );
    fireEvent.click(screen.getByRole("button", { name: "Google로 로그인" }));

    await waitFor(() => expect(navigateToAuth).toHaveBeenCalledWith(googleUrl));
    const loginCall = fetchMock.mock.calls.find(
      ([input]) => input.toString() === "/api/auth/sign-in/social"
    );
    expect(loginCall?.[1]).toEqual(
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ provider: "google", callbackURL: "/favorites" })
      })
    );
    expect(
      JSON.parse(
        window.sessionStorage.getItem(PENDING_FAVORITE_STORAGE_KEY) ?? "{}"
      )
    ).toMatchObject({ version: 1, song_id: "song-a" });
    expect(
      (
        screen.getByRole("button", {
          name: "로그인 준비 중"
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);

    fireEvent(window, new Event("pageshow"));

    expect(
      (
        screen.getByRole("button", {
          name: "Google로 로그인"
        }) as HTMLButtonElement
      ).disabled
    ).toBe(false);
  });

  it("keeps search usable and offers retry when login start fails", async () => {
    const fetchMock = installFetch({ auth: "guest", login: "failure" });

    render(<MobileSearchPage navigateToAuth={vi.fn()} />);
    await searchForSong();
    await waitForAuthCall(fetchMock);
    fireEvent.click(
      screen.getByRole("button", { name: "Sample Display 즐겨찾기에 추가" })
    );
    fireEvent.click(screen.getByRole("button", { name: "Google로 로그인" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "로그인 요청을 시작하지 못했습니다"
    );
    expect(screen.getByText("Sample Display")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Google로 로그인" })
    ).toBeTruthy();
  });

  it("contains sessionStorage set failures without starting login", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("disabled");
    });
    const fetchMock = installFetch({ auth: "guest", login: "success" });

    render(<MobileSearchPage navigateToAuth={vi.fn()} />);
    await searchForSong();
    await waitForAuthCall(fetchMock);
    fireEvent.click(
      screen.getByRole("button", { name: "Sample Display 즐겨찾기에 추가" })
    );
    fireEvent.click(screen.getByRole("button", { name: "Google로 로그인" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "안전하게 보관하지 못했습니다"
    );
    expect(
      fetchMock.mock.calls.some(
        ([input]) => input.toString() === "/api/auth/sign-in/social"
      )
    ).toBe(false);
    expect(screen.getByText("Sample Display")).toBeTruthy();
  });

  it("shows authenticated initial state and serializes a rapid optimistic delete", async () => {
    const mutation = deferred<Response>();
    const fetchMock = installFetch({
      auth: "authenticated",
      favoriteSongIds: ["song-a"],
      deleteResponse: () => mutation.promise
    });

    render(<MobileSearchPage />);
    await searchForSong();
    await waitFor(() =>
      expect(
        screen
          .getByRole("button", {
            name: "Sample Display 즐겨찾기에서 제거"
          })
          .getAttribute("aria-pressed")
      ).toBe("true")
    );

    const button = screen.getByRole("button", {
      name: "Sample Display 즐겨찾기에서 제거"
    });
    fireEvent.click(button);
    fireEvent.click(button);

    expect(
      screen
        .getByRole("button", { name: "Sample Display 즐겨찾기에 추가" })
        .getAttribute("aria-pressed")
    ).toBe("false");
    expect(mutationCalls(fetchMock)).toHaveLength(1);

    mutation.resolve(jsonResponse({ favorite: false }));
    await waitFor(() =>
      expect(
        (
          screen.getByRole("button", {
            name: "Sample Display 즐겨찾기에 추가"
          }) as HTMLButtonElement
        ).disabled
      ).toBe(false)
    );
  });

  it("rolls an optimistic add back after a network failure without touching search", async () => {
    const mutation = deferred<Response>();
    const fetchMock = installFetch({
      auth: "authenticated",
      favoriteSongIds: [],
      putResponse: () => mutation.promise
    });

    render(<MobileSearchPage />);
    await searchForSong();
    await waitForFavoriteList(fetchMock);
    fireEvent.click(
      screen.getByRole("button", { name: "Sample Display 즐겨찾기에 추가" })
    );

    expect(
      screen.getByRole("button", {
        name: "Sample Display 즐겨찾기에서 제거"
      })
    ).toBeTruthy();
    mutation.reject(new Error("network down"));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "이전 상태로 되돌렸습니다"
    );
    expect(
      screen.getByRole("button", { name: "Sample Display 즐겨찾기에 추가" })
    ).toBeTruthy();
    expect(screen.getByText("Sample Display")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "제공사별 비교" }));
    expect(screen.getByLabelText("제공사별 번호 비교")).toBeTruthy();
  });

  it("rolls back a 401 and offers re-login", async () => {
    const fetchMock = installFetch({
      auth: "authenticated",
      favoriteSongIds: [],
      putResponse: async () =>
        jsonResponse({ error: { code: "UNAUTHENTICATED" } }, 401)
    });

    render(<MobileSearchPage />);
    await searchForSong();
    await waitForFavoriteList(fetchMock);
    fireEvent.click(
      screen.getByRole("button", { name: "Sample Display 즐겨찾기에 추가" })
    );

    expect(await screen.findByText("세션이 만료되었습니다")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Sample Display 즐겨찾기에 추가" })
    ).toBeTruthy();
  });

  it("does not turn a failed favorite deletion into a pending add intent", async () => {
    const fetchMock = installFetch({
      auth: "authenticated",
      favoriteSongIds: ["song-a"],
      login: "success",
      deleteResponse: async () =>
        jsonResponse({ error: { code: "UNAUTHENTICATED" } }, 401)
    });
    const navigateToAuth = vi.fn();

    render(<MobileSearchPage navigateToAuth={navigateToAuth} />);
    await searchForSong();
    await waitForFavoriteList(fetchMock);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Sample Display 즐겨찾기에서 제거"
      })
    );

    expect(
      await screen.findByText(/즐겨찾기 해제를 다시 시도해 주세요/u)
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Google로 로그인" }));

    await waitFor(() => expect(navigateToAuth).toHaveBeenCalledWith(googleUrl));
    expect(
      window.sessionStorage.getItem(PENDING_FAVORITE_STORAGE_KEY)
    ).toBeNull();
  });

  it("keeps the login dialog open when a stored intent cannot be cancelled", async () => {
    const fetchMock = installFetch({ auth: "guest", login: "failure" });

    render(<MobileSearchPage navigateToAuth={vi.fn()} />);
    await searchForSong();
    await waitForAuthCall(fetchMock);
    fireEvent.click(
      screen.getByRole("button", { name: "Sample Display 즐겨찾기에 추가" })
    );
    fireEvent.click(screen.getByRole("button", { name: "Google로 로그인" }));
    await screen.findByText(/로그인 요청을 시작하지 못했습니다/u);

    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("disabled");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("disabled");
    });
    fireEvent.click(screen.getByRole("button", { name: "취소" }));

    expect(
      await screen.findByText(/자동 추가 요청을 취소하지 못했습니다/u)
    ).toBeTruthy();
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(
      window.sessionStorage.getItem(PENDING_FAVORITE_STORAGE_KEY)
    ).not.toBeNull();
  });

  it("moves, traps, and restores focus for the login dialog", async () => {
    const fetchMock = installFetch({ auth: "guest" });

    render(<MobileSearchPage />);
    await searchForSong();
    await waitForAuthCall(fetchMock);
    const favoriteButton = screen.getByRole("button", {
      name: "Sample Display 즐겨찾기에 추가"
    });
    favoriteButton.focus();
    fireEvent.click(favoriteButton);

    const loginButton = screen.getByRole("button", {
      name: "Google로 로그인"
    });
    const cancelButton = screen.getByRole("button", { name: "취소" });
    await waitFor(() => expect(document.activeElement).toBe(loginButton));
    fireEvent.keyDown(loginButton, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(cancelButton);
    fireEvent.keyDown(cancelButton, { key: "Tab" });
    expect(document.activeElement).toBe(loginButton);
    fireEvent.keyDown(loginButton, { key: "Escape" });

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(favoriteButton);
  });

  it("does not treat auth 503 as guest and keeps search/expansion usable", async () => {
    const fetchMock = installFetch({ auth: "unavailable" });

    render(<MobileSearchPage />);
    await searchForSong();
    await waitForAuthCall(fetchMock);
    fireEvent.click(
      screen.getByRole("button", { name: "Sample Display 즐겨찾기에 추가" })
    );

    expect(screen.queryByRole("dialog")).toBeNull();
    expect((await screen.findByRole("alert")).textContent).toContain(
      "로그인 상태를 확인하지 못했습니다"
    );
    expect(mutationCalls(fetchMock)).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "제공사별 비교" }));
    expect(screen.getByLabelText("제공사별 번호 비교")).toBeTruthy();
  });
});

async function searchForSong(): Promise<void> {
  await screen.findByLabelText("제공사");
  fireEvent.change(screen.getByLabelText("검색어"), {
    target: { value: "sample" }
  });
  fireEvent.submit(screen.getByRole("search"));
  await screen.findByText("Sample Display");
}

function installFetch(options: {
  auth: "guest" | "authenticated" | "unavailable";
  favoriteSongIds?: string[];
  login?: "success" | "failure";
  putResponse?: () => Promise<Response>;
  deleteResponse?: () => Promise<Response>;
}) {
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = input.toString();
      if (url === "/api/providers") {
        return jsonResponse({ items: [provider] });
      }
      if (url === "/api/user-preference") {
        return jsonResponse({ error: { code: "UNAUTHENTICATED" } }, 401);
      }
      if (url === "/api/auth/get-session") {
        if (options.auth === "unavailable") {
          return jsonResponse({ error: { code: "AUTH_UNAVAILABLE" } }, 503);
        }
        return jsonResponse(
          options.auth === "guest" ? null : { user: { id: "user-a" } }
        );
      }
      if (url.startsWith("/api/favorites?")) {
        return jsonResponse({
          items: (options.favoriteSongIds ?? []).map((songId) => ({
            song_id: songId,
            created_at: "2026-07-19T00:00:00.000Z",
            song: favoriteSong(songId)
          })),
          next_cursor: null
        });
      }
      if (url.startsWith("/api/search?")) {
        return jsonResponse(searchResponse);
      }
      if (url === "/api/favorites/song-a" && init?.method === "PUT") {
        return (
          options.putResponse?.() ??
          jsonResponse({
            favorite: true,
            created_at: "2026-07-19T00:00:00.000Z"
          })
        );
      }
      if (url === "/api/favorites/song-a" && init?.method === "DELETE") {
        return options.deleteResponse?.() ?? jsonResponse({ favorite: false });
      }
      if (url === "/api/auth/sign-in/social") {
        return options.login === "failure"
          ? jsonResponse({ error: { code: "AUTH_UNAVAILABLE" } }, 503)
          : jsonResponse({ url: googleUrl, redirect: true });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function favoriteSong(songId: string) {
  return {
    id: songId,
    original_language: "ja",
    canonical_title: "Sample Canonical",
    display_title: "Sample Display",
    canonical_artist: "Sample Artist",
    release_year: 2026,
    tie_in: null,
    karaoke_entries: [
      {
        id: "entry-a",
        provider_id: "provider-a",
        karaoke_number: "12345",
        version_info: "",
        availability_status: "available",
        last_verified_at: "2026-07-01",
        is_stale: false,
        provider
      }
    ],
    distinguishing_labels: ["Sample Artist", "2026"]
  };
}

function waitForAuthCall(fetchMock: ReturnType<typeof installFetch>) {
  return waitFor(() =>
    expect(
      fetchMock.mock.calls.some(
        ([input]) => input.toString() === "/api/auth/get-session"
      )
    ).toBe(true)
  );
}

function waitForFavoriteList(fetchMock: ReturnType<typeof installFetch>) {
  return waitFor(() =>
    expect(
      fetchMock.mock.calls.some(([input]) =>
        input.toString().startsWith("/api/favorites?")
      )
    ).toBe(true)
  );
}

function mutationCalls(fetchMock: ReturnType<typeof installFetch>) {
  return fetchMock.mock.calls.filter(
    ([input, init]) =>
      input.toString() === "/api/favorites/song-a" &&
      (init?.method === "PUT" || init?.method === "DELETE")
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
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}
