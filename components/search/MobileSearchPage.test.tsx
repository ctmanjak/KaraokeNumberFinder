// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MobileSearchPage } from "./MobileSearchPage";

const providers = [
  {
    id: "provider_secondary",
    name: "Generic Provider Secondary",
    country: "KR",
    is_active: true,
    display_order: 20,
    is_default: false,
    last_catalog_updated_at: null
  },
  {
    id: "provider_default",
    name: "Generic Provider Default",
    country: "KR",
    is_active: true,
    display_order: 10,
    is_default: true,
    last_catalog_updated_at: null
  }
];

const searchResponse = {
  query: "sample title",
  normalized_query: "sampletitle",
  items: [
    {
      song: {
        id: "song_sample_001",
        original_language: "ja",
        canonical_title: "Sample Canonical Title",
        display_title: "Sample Display Title",
        canonical_artist: "Sample Artist",
        release_year: 2026,
        tie_in: "Sample Tie In",
        matched_aliases: [
          {
            id: "alias_sample_001",
            alias: "Sample Matched Alias",
            language: "en",
            alias_type: "translated_title"
          }
        ]
      },
      karaoke_entries: [],
      distinguishing_labels: ["Sample Artist", "Sample Tie In", "2026"],
      relevance_score: 100
    }
  ],
  next_cursor: null,
  suggestions: []
};

describe("MobileSearchPage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("loads providers and selects the default provider", async () => {
    mockFetch([{ ok: true, body: { items: providers } }]);

    render(<MobileSearchPage />);

    const select = await screen.findByLabelText("제공사");

    expect((select as HTMLSelectElement).value).toBe("provider_default");
  });

  it("falls back to the first active provider when no default exists", async () => {
    mockFetch([
      {
        ok: true,
        body: {
          items: providers.map((provider) => ({
            ...provider,
            is_default: false
          }))
        }
      }
    ]);

    render(<MobileSearchPage />);

    const select = await screen.findByLabelText("제공사");

    expect((select as HTMLSelectElement).value).toBe("provider_secondary");
  });

  it("does not call search API before submit or while typing", async () => {
    const fetchMock = mockFetch([{ ok: true, body: { items: providers } }]);

    render(<MobileSearchPage />);

    await screen.findByLabelText("제공사");
    fireEvent.change(screen.getByLabelText("검색어"), {
      target: { value: "sample title" }
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/providers");
  });

  it("calls search API when the search button submits", async () => {
    const fetchMock = mockFetch([
      { ok: true, body: { items: providers } },
      { ok: true, body: searchResponse }
    ]);

    render(<MobileSearchPage />);

    await screen.findByLabelText("제공사");
    fireEvent.change(screen.getByLabelText("검색어"), {
      target: { value: "sample title" }
    });
    fireEvent.click(screen.getByRole("button", { name: "검색" }));

    await screen.findByText("Sample Display Title");

    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/search?q=sample+title&provider_id=provider_default"
    );
  });

  it("calls search API when Enter submits", async () => {
    const fetchMock = mockFetch([
      { ok: true, body: { items: providers } },
      { ok: true, body: searchResponse }
    ]);

    render(<MobileSearchPage />);

    await screen.findByLabelText("제공사");
    fireEvent.change(screen.getByLabelText("검색어"), {
      target: { value: "sample title" }
    });
    fireEvent.submit(screen.getByRole("search"));

    await screen.findByText("Sample Display Title");

    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/search?q=sample+title&provider_id=provider_default"
    );
  });

  it("does not call search API for a blank query", async () => {
    const fetchMock = mockFetch([{ ok: true, body: { items: providers } }]);

    render(<MobileSearchPage />);

    await screen.findByLabelText("제공사");
    fireEvent.change(screen.getByLabelText("검색어"), {
      target: { value: "   " }
    });
    fireEvent.submit(screen.getByRole("search"));

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("includes the selected provider_id in search requests", async () => {
    const fetchMock = mockFetch([
      { ok: true, body: { items: providers } },
      { ok: true, body: searchResponse }
    ]);

    render(<MobileSearchPage />);

    const select = await screen.findByLabelText("제공사");
    fireEvent.change(select, { target: { value: "provider_secondary" } });
    fireEvent.change(screen.getByLabelText("검색어"), {
      target: { value: "sample title" }
    });
    fireEvent.click(screen.getByRole("button", { name: "검색" }));

    await screen.findByText("Sample Display Title");

    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/search?q=sample+title&provider_id=provider_secondary"
    );
  });

  it("keeps the submitted provider in the result summary until a new search submits", async () => {
    mockFetch([
      { ok: true, body: { items: providers } },
      { ok: true, body: searchResponse }
    ]);

    const { container } = render(<MobileSearchPage />);

    const select = await screen.findByLabelText("제공사");
    fireEvent.change(screen.getByLabelText("검색어"), {
      target: { value: "sample title" }
    });
    fireEvent.click(screen.getByRole("button", { name: "검색" }));

    await screen.findByText("Sample Display Title");
    fireEvent.change(select, { target: { value: "provider_secondary" } });

    const summary = container.querySelector(".results-summary");

    expect(summary?.textContent).toContain("Generic Provider Default");
    expect(summary?.textContent).not.toContain("Generic Provider Secondary");
  });

  it("ignores stale search responses when requests resolve out of order", async () => {
    const slowSearch = deferred<Response>();
    const fastSearch = deferred<Response>();
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = input.toString();

      if (url === "/api/providers") {
        return Promise.resolve(jsonResponse({ items: providers }));
      }

      if (url.startsWith("/api/search?q=slow")) {
        return slowSearch.promise;
      }

      if (url.startsWith("/api/search?q=fast")) {
        return fastSearch.promise;
      }

      throw new Error(`Unexpected fetch call: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<MobileSearchPage />);

    await screen.findByLabelText("제공사");
    fireEvent.change(screen.getByLabelText("검색어"), {
      target: { value: "slow" }
    });
    fireEvent.submit(screen.getByRole("search"));
    fireEvent.change(screen.getByLabelText("검색어"), {
      target: { value: "fast" }
    });
    fireEvent.submit(screen.getByRole("search"));

    fastSearch.resolve(
      jsonResponse(
        searchResponseWithSong({
          id: "song_fast_001",
          displayTitle: "Fast Display Title"
        })
      )
    );

    expect(await screen.findByText("Fast Display Title")).toBeTruthy();

    slowSearch.resolve(
      jsonResponse(
        searchResponseWithSong({
          id: "song_slow_001",
          displayTitle: "Slow Display Title"
        })
      )
    );

    await waitFor(() => {
      expect(screen.queryByText("Slow Display Title")).toBeNull();
      expect(screen.getByText("Fast Display Title")).toBeTruthy();
    });
  });

  it("renders the result list shell after a successful search", async () => {
    mockFetch([
      { ok: true, body: { items: providers } },
      { ok: true, body: searchResponse }
    ]);

    render(<MobileSearchPage />);

    await screen.findByLabelText("제공사");
    fireEvent.change(screen.getByLabelText("검색어"), {
      target: { value: "sample title" }
    });
    fireEvent.click(screen.getByRole("button", { name: "검색" }));

    expect(await screen.findByText("Sample Display Title")).toBeTruthy();
    expect(screen.getByText("Sample Canonical Title")).toBeTruthy();
    expect(screen.getAllByText("Sample Artist").length).toBeGreaterThan(0);
    expect(screen.getByText("일치한 별칭: Sample Matched Alias")).toBeTruthy();
    expect(screen.getByText("관련도 100")).toBeTruthy();
  });

  it("renders an error state after a failed search", async () => {
    mockFetch([
      { ok: true, body: { items: providers } },
      {
        ok: false,
        status: 500,
        body: { error: { code: "SEARCH_FAILED", message: "Search failed." } }
      }
    ]);

    render(<MobileSearchPage />);

    await screen.findByLabelText("제공사");
    fireEvent.change(screen.getByLabelText("검색어"), {
      target: { value: "sample title" }
    });
    fireEvent.click(screen.getByRole("button", { name: "검색" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Search failed."
    );
    expect(screen.getByRole("button", { name: "다시 시도" })).toBeTruthy();
  });

  it("keeps search available when provider loading fails", async () => {
    const fetchMock = mockFetch([
      {
        ok: false,
        status: 500,
        body: {
          error: {
            code: "PROVIDER_LIST_FAILED",
            message: "Provider loading failed."
          }
        }
      },
      { ok: true, body: searchResponse }
    ]);

    render(<MobileSearchPage />);

    expect(await screen.findByText(/Provider loading failed/u)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("검색어"), {
      target: { value: "sample title" }
    });
    fireEvent.click(screen.getByRole("button", { name: "검색" }));

    await screen.findByText("Sample Display Title");

    expect(fetchMock).toHaveBeenLastCalledWith("/api/search?q=sample+title");
  });
});

function mockFetch(
  responses: Array<{ ok: boolean; status?: number; body: unknown }>
) {
  const fetchMock = vi.fn(async () => {
    const response = responses.shift();

    if (response === undefined) {
      throw new Error("Unexpected fetch call.");
    }

    return {
      ok: response.ok,
      status: response.status ?? (response.ok ? 200 : 500),
      json: async () => response.body
    } as Response;
  });

  vi.stubGlobal("fetch", fetchMock);

  return fetchMock;
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

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => body
  } as Response;
}

function searchResponseWithSong({
  displayTitle,
  id
}: {
  displayTitle: string;
  id: string;
}) {
  return {
    ...searchResponse,
    items: [
      {
        ...searchResponse.items[0],
        song: {
          ...searchResponse.items[0].song,
          display_title: displayTitle,
          id
        }
      }
    ]
  };
}
