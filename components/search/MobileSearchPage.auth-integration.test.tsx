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
import { AuthProvider, useAuth } from "@/components/auth/AuthProvider";
import { MobileSearchPage } from "./MobileSearchPage";

const provider = {
  id: "provider-a",
  name: "Provider A",
  country: "KR",
  is_active: true,
  display_order: 1,
  is_default: true,
  last_catalog_updated_at: null
};

describe("MobileSearchPage shared auth integration", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("clears server personalization after logout while keeping public search state", async () => {
    const fetcher = installFetch();
    render(
      <AuthProvider>
        <MobileSearchPage />
        <LogoutControl />
      </AuthProvider>
    );

    expect(await screen.findByText("server recent")).toBeTruthy();
    await waitFor(() =>
      expect(
        fetcher.mock.calls.some(([input]) =>
          input.toString().startsWith("/api/favorites?")
        )
      ).toBe(true)
    );

    fireEvent.change(screen.getByLabelText("검색어"), {
      target: { value: "sample" }
    });
    fireEvent.submit(screen.getByRole("search"));
    expect(
      await screen.findByRole("heading", { name: "Sample Song" })
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Sample Song 즐겨찾기에서 제거" })
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "테스트 로그아웃" }));

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Sample Song 즐겨찾기에 추가" })
      ).toBeTruthy()
    );
    expect(screen.queryByText("server recent")).toBeNull();
    expect(screen.getByRole("heading", { name: "Sample Song" })).toBeTruthy();
    expect((screen.getByLabelText("검색어") as HTMLInputElement).value).toBe(
      "sample"
    );
  });

  it("does not render the previous user's personalization during an account switch", async () => {
    const nextSession = deferred<Response>();
    const nextFavorites = deferred<Response>();
    const nextHistory = deferred<Response>();
    let sessionRequestCount = 0;
    let favoriteRequestCount = 0;
    let historyRequestCount = 0;
    const fetcher = vi.fn(
      async (
        input: RequestInfo | URL,
        init?: RequestInit
      ): Promise<Response> => {
        const url = input.toString();
        if (url === "/api/auth/get-session") {
          sessionRequestCount += 1;
          return sessionRequestCount === 1
            ? jsonResponse({ user: { id: "user-a", name: "Alice" } })
            : nextSession.promise;
        }
        if (url === "/api/providers") {
          return jsonResponse({ items: [provider] });
        }
        if (url === "/api/user-preference") {
          return jsonResponse({ default_provider: provider, source: "user" });
        }
        if (url.startsWith("/api/favorites?")) {
          favoriteRequestCount += 1;
          return favoriteRequestCount === 1
            ? jsonResponse({ items: [favoriteItem()], next_cursor: null })
            : nextFavorites.promise;
        }
        if (url === "/api/search-history" && init?.method === undefined) {
          historyRequestCount += 1;
          return historyRequestCount === 1
            ? jsonResponse({ items: [historyItem("user a recent")] })
            : nextHistory.promise;
        }
        if (url === "/api/search-history" && init?.method === "POST") {
          return jsonResponse({ item: historyItem("sample") });
        }
        if (url.startsWith("/api/search?")) {
          return jsonResponse(searchResponse());
        }
        throw new Error(`Unexpected fetch: ${url} (${init?.method})`);
      }
    );
    vi.stubGlobal("fetch", fetcher);

    render(
      <AuthProvider>
        <MobileSearchPage />
        <RefreshControl />
      </AuthProvider>
    );
    expect(await screen.findByText("user a recent")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("검색어"), {
      target: { value: "sample" }
    });
    fireEvent.submit(screen.getByRole("search"));
    expect(
      await screen.findByRole("button", {
        name: "Sample Song 즐겨찾기에서 제거"
      })
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "계정 새로고침" }));
    expect(screen.queryByText("user a recent")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Sample Song 즐겨찾기에 추가" })
    ).toBeTruthy();

    nextSession.resolve(jsonResponse({ user: { id: "user-b", name: "Bob" } }));
    expect(await screen.findByText("user-b")).toBeTruthy();
    await waitFor(() => {
      expect(favoriteRequestCount).toBe(2);
      expect(historyRequestCount).toBe(2);
    });
    expect(screen.queryByText("user a recent")).toBeNull();

    nextFavorites.resolve(jsonResponse({ items: [], next_cursor: null }));
    nextHistory.resolve(
      jsonResponse({ items: [historyItem("user b recent")] })
    );
    expect(await screen.findByText("user b recent")).toBeTruthy();
  });

  it("does not reload favorites or history when providers arrive later", async () => {
    const providerResponse = deferred<Response>();
    let favoriteRequestCount = 0;
    let historyRequestCount = 0;
    const fetcher = vi.fn(
      async (
        input: RequestInfo | URL,
        init?: RequestInit
      ): Promise<Response> => {
        const url = input.toString();
        if (url === "/api/auth/get-session") {
          return jsonResponse({ user: { id: "user-a", name: "Alice" } });
        }
        if (url === "/api/providers") {
          return providerResponse.promise;
        }
        if (url === "/api/user-preference" && init?.method === undefined) {
          return jsonResponse({ default_provider: provider, source: "user" });
        }
        if (url.startsWith("/api/favorites?")) {
          favoriteRequestCount += 1;
          return jsonResponse({ items: [], next_cursor: null });
        }
        if (url === "/api/search-history" && init?.method === undefined) {
          historyRequestCount += 1;
          return jsonResponse({ items: [] });
        }
        throw new Error(`Unexpected fetch: ${url} (${init?.method})`);
      }
    );
    vi.stubGlobal("fetch", fetcher);

    render(
      <AuthProvider>
        <MobileSearchPage />
      </AuthProvider>
    );
    await waitFor(() => {
      expect(favoriteRequestCount).toBe(1);
      expect(historyRequestCount).toBe(1);
    });

    await act(async () => {
      providerResponse.resolve(jsonResponse({ items: [provider] }));
      await providerResponse.promise;
    });
    expect(await screen.findByLabelText("제공사")).toBeTruthy();
    await waitFor(() =>
      expect(
        fetcher.mock.calls.some(
          ([input]) => input.toString() === "/api/user-preference"
        )
      ).toBe(true)
    );
    expect(favoriteRequestCount).toBe(1);
    expect(historyRequestCount).toBe(1);
  });
});

function LogoutControl() {
  const auth = useAuth();
  return (
    <button type="button" onClick={() => void auth.signOut()}>
      테스트 로그아웃
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

function installFetch() {
  const fetcher = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = input.toString();
      if (url === "/api/auth/get-session") {
        return jsonResponse({ user: { id: "user-a", name: "Alice" } });
      }
      if (url === "/api/auth/sign-out") {
        return jsonResponse({ success: true });
      }
      if (url === "/api/providers") {
        return jsonResponse({ items: [provider] });
      }
      if (url === "/api/user-preference") {
        return jsonResponse({ default_provider: provider, source: "user" });
      }
      if (url.startsWith("/api/favorites?")) {
        return jsonResponse({
          items: [favoriteItem()],
          next_cursor: null
        });
      }
      if (url === "/api/search-history" && init?.method === undefined) {
        return jsonResponse({ items: [historyItem("server recent")] });
      }
      if (url === "/api/search-history" && init?.method === "POST") {
        return jsonResponse({ item: historyItem("sample") });
      }
      if (url.startsWith("/api/search?")) {
        return jsonResponse(searchResponse());
      }
      throw new Error(`Unexpected fetch: ${url} (${init?.method})`);
    }
  );
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}

function historyItem(query: string) {
  return {
    id:
      query === "sample"
        ? "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa"
        : "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb",
    query,
    normalized_query: query.replaceAll(" ", ""),
    searched_at: "2026-07-20T00:00:00.000Z"
  };
}

function favoriteItem() {
  return {
    song_id: "song-a",
    created_at: "2026-07-20T00:00:00.000Z",
    song: {
      id: "song-a",
      original_language: "ja",
      canonical_title: "Sample Song",
      display_title: "Sample Song",
      canonical_artist: "Artist",
      release_year: 2026,
      tie_in: null,
      karaoke_entries: [
        {
          id: "entry-a",
          provider_id: provider.id,
          karaoke_number: "12345",
          version_info: "",
          availability_status: "available",
          last_verified_at: "2026-07-01",
          is_stale: false,
          provider
        }
      ],
      distinguishing_labels: ["Artist", "2026"]
    }
  };
}

function searchResponse() {
  return {
    query: "sample",
    normalized_query: "sample",
    items: [
      {
        song: {
          id: "song-a",
          original_language: "ja",
          canonical_title: "Sample Song",
          display_title: "Sample Song",
          canonical_artist: "Artist",
          release_year: 2026,
          tie_in: null,
          matched_aliases: []
        },
        karaoke_entries: [
          {
            id: "entry-a",
            provider_id: provider.id,
            karaoke_number: "12345",
            version_info: "",
            availability_status: "available",
            last_verified_at: "2026-07-01",
            is_stale: false
          }
        ],
        distinguishing_labels: ["Artist", "2026"],
        relevance_score: 100
      }
    ],
    next_cursor: null,
    suggestions: []
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
