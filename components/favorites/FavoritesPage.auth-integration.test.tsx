// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "@/components/auth/AuthProvider";
import { FavoritesPage } from "./FavoritesPage";

describe("FavoritesPage shared auth integration", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("does not let a slow favorite response survive session expiration", async () => {
    const favoriteResponse = deferred<Response>();
    const fetcher = vi.fn(
      async (input: RequestInfo | URL): Promise<Response> => {
        const url = input.toString();
        if (url === "/api/auth/get-session") {
          return jsonResponse({ user: { id: "user-a" } });
        }
        if (url.startsWith("/api/favorites?")) {
          return favoriteResponse.promise;
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }
    );
    vi.stubGlobal("fetch", fetcher);

    render(
      <AuthProvider>
        <FavoritesPage />
        <ExpireControl />
      </AuthProvider>
    );
    await waitFor(() =>
      expect(
        fetcher.mock.calls.some(([input]) =>
          input.toString().startsWith("/api/favorites?")
        )
      ).toBe(true)
    );

    fireEvent.click(screen.getByRole("button", { name: "세션 만료 처리" }));
    expect(await screen.findByText("세션이 만료되었습니다")).toBeTruthy();

    favoriteResponse.resolve(
      jsonResponse({ items: [favoriteItem()], next_cursor: null })
    );
    await Promise.resolve();
    expect(screen.queryByText("Private Favorite")).toBeNull();
  });

  it("hides the previous user's favorites throughout an account switch", async () => {
    const nextSession = deferred<Response>();
    const nextFavorites = deferred<Response>();
    let sessionRequestCount = 0;
    let favoriteRequestCount = 0;
    const fetcher = vi.fn(
      async (input: RequestInfo | URL): Promise<Response> => {
        const url = input.toString();
        if (url === "/api/auth/get-session") {
          sessionRequestCount += 1;
          return sessionRequestCount === 1
            ? jsonResponse({ user: { id: "user-a" } })
            : nextSession.promise;
        }
        if (url.startsWith("/api/favorites?")) {
          favoriteRequestCount += 1;
          return favoriteRequestCount === 1
            ? jsonResponse({
                items: [favoriteItem("User A Favorite", "song-a")],
                next_cursor: null
              })
            : nextFavorites.promise;
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }
    );
    vi.stubGlobal("fetch", fetcher);

    render(
      <AuthProvider>
        <FavoritesPage />
        <RefreshControl />
      </AuthProvider>
    );
    expect(await screen.findByText("User A Favorite")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "계정 새로고침" }));
    expect(screen.queryByText("User A Favorite")).toBeNull();

    nextSession.resolve(jsonResponse({ user: { id: "user-b" } }));
    expect(await screen.findByText("user-b")).toBeTruthy();
    await waitFor(() => expect(favoriteRequestCount).toBe(2));
    expect(screen.queryByText("User A Favorite")).toBeNull();

    nextFavorites.resolve(
      jsonResponse({
        items: [favoriteItem("User B Favorite", "song-b")],
        next_cursor: null
      })
    );
    expect(await screen.findByText("User B Favorite")).toBeTruthy();
  });
});

function ExpireControl() {
  const auth = useAuth();
  return (
    <button type="button" onClick={auth.markExpired}>
      세션 만료 처리
    </button>
  );
}

function RefreshControl() {
  const auth = useAuth();
  return (
    <>
      <button type="button" onClick={() => void auth.refresh()}>
        계정 새로고침
      </button>
      <span>
        {auth.state.status === "authenticated" ? auth.state.user.id : "none"}
      </span>
    </>
  );
}

function favoriteItem(title = "Private Favorite", songId = "song-private") {
  return {
    song_id: songId,
    created_at: "2026-07-20T00:00:00.000Z",
    song: {
      id: songId,
      original_language: "ja",
      canonical_title: title,
      display_title: title,
      canonical_artist: "Artist",
      release_year: 2026,
      tie_in: null,
      karaoke_entries: [],
      distinguishing_labels: ["Artist"]
    }
  };
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
