// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PENDING_FAVORITE_STORAGE_KEY,
  writePendingFavoriteIntent
} from "@/lib/favorites/pending-intent";
import { FavoritesPage } from "./FavoritesPage";

describe("FavoritesPage", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("renders guest and auth-unavailable states separately", async () => {
    installFetch({ auth: "guest" });
    const first = render(<FavoritesPage />);
    expect(await screen.findByText("로그인이 필요합니다")).toBeTruthy();
    first.unmount();

    installFetch({ auth: "unavailable" });
    render(<FavoritesPage />);
    expect(
      await screen.findByText("인증 시스템에 일시적으로 연결할 수 없습니다.")
    ).toBeTruthy();
    expect(screen.queryByText("로그인이 필요합니다")).toBeNull();
  });

  it("restores the login button after returning from Google", async () => {
    installFetch({ auth: "guest" });
    const navigateToAuth = vi.fn();
    render(<FavoritesPage navigateToAuth={navigateToAuth} />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Google로 로그인" })
    );

    await waitFor(() => expect(navigateToAuth).toHaveBeenCalledOnce());
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

  it("renders an empty authenticated favorite list", async () => {
    installFetch({ auth: "authenticated", pages: [favoritePage([])] });

    render(<FavoritesPage />);

    expect(await screen.findByText("아직 즐겨찾기가 없습니다.")).toBeTruthy();
  });

  it("automatically adds only the one valid pending song and clears it on success", async () => {
    writePendingFavoriteIntent("song-old");
    writePendingFavoriteIntent("song-pending");
    const fetchMock = installFetch({
      auth: "authenticated",
      pages: [favoritePage(["song-pending"])],
      putResponses: [
        jsonResponse({
          favorite: true,
          created_at: "2026-07-19T00:00:00.000Z"
        })
      ]
    });

    render(<FavoritesPage />);

    expect(
      await screen.findByText(
        "로그인 전에 선택한 곡을 즐겨찾기에 추가했습니다."
      )
    ).toBeTruthy();
    expect(screen.getByText("Display song-pending")).toBeTruthy();
    expect(
      window.sessionStorage.getItem(PENDING_FAVORITE_STORAGE_KEY)
    ).toBeNull();
    expect(favoriteMutationUrls(fetchMock, "PUT")).toEqual([
      "/api/favorites/song-pending"
    ]);
  });

  it("retains a retryable pending intent, retries it, and then clears it", async () => {
    writePendingFavoriteIntent("song-pending");
    const fetchMock = installFetch({
      auth: "authenticated",
      pages: [favoritePage([]), favoritePage(["song-pending"])],
      putResponses: [
        jsonResponse({ error: { code: "PERSONALIZATION_UNAVAILABLE" } }, 503),
        jsonResponse({
          favorite: true,
          created_at: "2026-07-19T00:00:00.000Z"
        })
      ]
    });

    render(<FavoritesPage />);

    expect(await screen.findByText(/아직 추가하지 못했습니다/u)).toBeTruthy();
    expect(
      window.sessionStorage.getItem(PENDING_FAVORITE_STORAGE_KEY)
    ).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));

    await waitFor(() =>
      expect(
        window.sessionStorage.getItem(PENDING_FAVORITE_STORAGE_KEY)
      ).toBeNull()
    );
    expect(await screen.findByText("Display song-pending")).toBeTruthy();
    expect(favoriteMutationUrls(fetchMock, "PUT")).toEqual([
      "/api/favorites/song-pending",
      "/api/favorites/song-pending"
    ]);
  });

  it("cancels a retryable pending intent without another mutation", async () => {
    writePendingFavoriteIntent("song-pending");
    const fetchMock = installFetch({
      auth: "authenticated",
      pages: [favoritePage([])],
      putResponses: [
        jsonResponse({ error: { code: "PERSONALIZATION_UNAVAILABLE" } }, 503)
      ]
    });

    render(<FavoritesPage />);
    await screen.findByText(/아직 추가하지 못했습니다/u);
    fireEvent.click(screen.getByRole("button", { name: "취소" }));

    expect(await screen.findByText(/자동 추가를 취소했습니다/u)).toBeTruthy();
    expect(
      window.sessionStorage.getItem(PENDING_FAVORITE_STORAGE_KEY)
    ).toBeNull();
    expect(favoriteMutationUrls(fetchMock, "PUT")).toHaveLength(1);
  });

  it("does not report cancellation when storage cannot invalidate the intent", async () => {
    writePendingFavoriteIntent("song-pending");
    installFetch({
      auth: "authenticated",
      pages: [favoritePage([])],
      putResponses: [
        jsonResponse({ error: { code: "PERSONALIZATION_UNAVAILABLE" } }, 503)
      ]
    });

    render(<FavoritesPage />);
    await screen.findByText(/아직 추가하지 못했습니다/u);
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
    expect(screen.getByRole("button", { name: "다시 정리" })).toBeTruthy();
    expect(
      window.sessionStorage.getItem(PENDING_FAVORITE_STORAGE_KEY)
    ).not.toBeNull();
  });

  it("discards a non-retryable missing-song intent", async () => {
    writePendingFavoriteIntent("missing");
    installFetch({
      auth: "authenticated",
      pages: [favoritePage([])],
      putResponses: [jsonResponse({ error: { code: "SONG_NOT_FOUND" } }, 404)]
    });

    render(<FavoritesPage />);

    expect(
      await screen.findByText(/찾을 수 없어 자동 추가를 취소했습니다/u)
    ).toBeTruthy();
    expect(
      window.sessionStorage.getItem(PENDING_FAVORITE_STORAGE_KEY)
    ).toBeNull();
  });

  it("loads cursor pages and appends without inventing search fields", async () => {
    const fetchMock = installFetch({
      auth: "authenticated",
      pages: [favoritePage(["song-a"], "cursor-2"), favoritePage(["song-b"])]
    });

    render(<FavoritesPage />);
    expect(await screen.findByText("Display song-a")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "더 보기" }));

    expect(await screen.findByText("Display song-b")).toBeTruthy();
    expect(
      fetchMock.mock.calls.some(([input]) =>
        input.toString().includes("cursor=cursor-2")
      )
    ).toBe(true);
    expect(screen.queryByText(/관련도/u)).toBeNull();
  });

  it("optimistically removes and restores the original item order on 5xx", async () => {
    const deletion = deferred<Response>();
    installFetch({
      auth: "authenticated",
      pages: [favoritePage(["song-a", "song-b"])],
      deleteResponse: () => deletion.promise
    });

    render(<FavoritesPage />);
    await screen.findByText("Display song-b");
    fireEvent.click(
      screen.getByRole("button", { name: "Display song-a 즐겨찾기에서 제거" })
    );

    expect(screen.queryByText("Display song-a")).toBeNull();
    deletion.resolve(
      jsonResponse({ error: { code: "PERSONALIZATION_UNAVAILABLE" } }, 503)
    );

    expect(
      await screen.findByText("삭제에 실패해 항목과 순서를 복구했습니다.")
    ).toBeTruthy();
    const cards = screen.getAllByRole("listitem");
    expect(cards.map((card) => card.textContent)).toEqual([
      expect.stringContaining("Display song-a"),
      expect.stringContaining("Display song-b")
    ]);
  });

  it("keeps loading the list when sessionStorage access throws", async () => {
    vi.spyOn(window, "sessionStorage", "get").mockImplementation(() => {
      throw new Error("disabled");
    });
    installFetch({ auth: "authenticated", pages: [favoritePage([])] });

    render(<FavoritesPage />);

    expect(await screen.findByText("아직 즐겨찾기가 없습니다.")).toBeTruthy();
  });
});

function installFetch(options: {
  auth: "guest" | "authenticated" | "unavailable";
  pages?: unknown[];
  putResponses?: Response[];
  deleteResponse?: () => Promise<Response>;
}) {
  const pages = [...(options.pages ?? [])];
  const putResponses = [...(options.putResponses ?? [])];
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = input.toString();
      if (url === "/api/auth/get-session") {
        if (options.auth === "unavailable") {
          return jsonResponse({ error: { code: "AUTH_UNAVAILABLE" } }, 503);
        }
        return jsonResponse(
          options.auth === "guest" ? null : { user: { id: "user-a" } }
        );
      }
      if (url.startsWith("/api/favorites?") && init?.method === undefined) {
        const page = pages.shift();
        if (page === undefined) throw new Error("Unexpected favorite page");
        return jsonResponse(page);
      }
      if (url.startsWith("/api/favorites/") && init?.method === "PUT") {
        const response = putResponses.shift();
        if (response === undefined) throw new Error("Unexpected favorite PUT");
        return response;
      }
      if (url.startsWith("/api/favorites/") && init?.method === "DELETE") {
        return options.deleteResponse?.() ?? jsonResponse({ favorite: false });
      }
      if (url === "/api/auth/sign-in/social") {
        return jsonResponse({
          url: "https://accounts.google.com/o/oauth2/v2/auth?state=state",
          redirect: true
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function favoritePage(songIds: string[], nextCursor: string | null = null) {
  return {
    items: songIds.map((songId) => ({
      song_id: songId,
      created_at: "2026-07-19T00:00:00.000Z",
      song: favoriteSong(songId)
    })),
    next_cursor: nextCursor
  };
}

function favoriteSong(songId: string) {
  return {
    id: songId,
    original_language: "ja",
    canonical_title: `Canonical ${songId}`,
    display_title: `Display ${songId}`,
    canonical_artist: "Artist",
    release_year: 2026,
    tie_in: null,
    karaoke_entries: [
      {
        id: `entry-${songId}`,
        provider_id: "provider-a",
        karaoke_number: "12345",
        version_info: "",
        availability_status: "available",
        last_verified_at: "2026-07-01",
        is_stale: false,
        provider: {
          id: "provider-a",
          name: "Provider A",
          country: "KR",
          is_active: true,
          display_order: 1,
          is_default: true,
          last_catalog_updated_at: null
        }
      }
    ],
    distinguishing_labels: ["Artist", "2026"]
  };
}

function favoriteMutationUrls(
  fetchMock: ReturnType<typeof installFetch>,
  method: "PUT" | "DELETE"
) {
  return fetchMock.mock.calls
    .filter(([, init]) => init?.method === method)
    .map(([input]) => input.toString());
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
