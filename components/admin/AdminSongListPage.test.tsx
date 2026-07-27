// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "@/components/auth/AuthProvider";
import { AdminSongListPage } from "./AdminSongListPage";

describe("administrator song list page", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("renders the list projection, management links, and new-song CTA", async () => {
    const fetcher = adminFetcher(
      jsonResponse({
        items: [songItem("song-a")],
        next_cursor: null
      })
    );
    vi.stubGlobal("fetch", fetcher);

    renderPage();

    expect(
      await screen.findByRole("heading", { name: "표시 제목 song-a" })
    ).toBeTruthy();
    expect(screen.getByText("원제 Original song-a")).toBeTruthy();
    expect(screen.getByText("Artist song-a")).toBeTruthy();
    expect(screen.getByText("TJ")).toBeTruthy();
    expect(screen.getByText("12345 · original")).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: /표시 제목 song-a/ })
        .getAttribute("href")
    ).toBe("/admin/songs/song-a");
    expect(
      screen.getByRole("link", { name: "새 노래 추가" }).getAttribute("href")
    ).toBe("/admin/songs/new");
  });

  it("distinguishes loading and empty search states", async () => {
    const pending = deferred<Response>();
    const fetcher = adminFetcher(pending.promise);
    vi.stubGlobal("fetch", fetcher);

    renderPage();
    expect(
      await screen.findByText("노래 목록을 불러오는 중입니다.")
    ).toBeTruthy();

    pending.resolve(jsonResponse({ items: [], next_cursor: null }));
    expect(
      await screen.findByText("조건에 맞는 노래가 없습니다.")
    ).toBeTruthy();
  });

  it("sends an explicit query and retries a failed request", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(adminSession())
      .mockResolvedValueOnce(
        jsonResponse({ items: [songItem("initial")], next_cursor: null })
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {
            error: {
              code: "PERSONALIZATION_UNAVAILABLE",
              message: "Unavailable.",
              request_id: "request-a"
            }
          },
          500
        )
      )
      .mockResolvedValueOnce(
        jsonResponse({ items: [songItem("retry")], next_cursor: null })
      );
    vi.stubGlobal("fetch", fetcher);

    renderPage();
    await screen.findByRole("heading", { name: "표시 제목 initial" });
    fireEvent.change(screen.getByLabelText("카탈로그 검색"), {
      target: { value: "Mixed CASE" }
    });
    fireEvent.click(screen.getByRole("button", { name: "검색" }));

    expect(
      await screen.findByText("노래 목록을 불러오지 못했습니다.")
    ).toBeTruthy();
    expect(fetcher).toHaveBeenCalledWith(
      "/api/admin/songs?query=Mixed+CASE",
      expect.objectContaining({ cache: "no-store" })
    );
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(
      await screen.findByRole("heading", { name: "표시 제목 retry" })
    ).toBeTruthy();
  });

  it("renders the feature-off state separately with accessible links", async () => {
    vi.stubGlobal(
      "fetch",
      adminFetcher(
        jsonResponse(
          {
            error: {
              code: "ADMIN_CATALOG_NOT_ENABLED",
              message: "Not enabled.",
              request_id: "request-off"
            }
          },
          403
        )
      )
    );

    renderPage();

    expect(
      await screen.findByRole("heading", {
        name: "관리자 카탈로그가 아직 활성화되지 않았습니다"
      })
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "홈으로" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "공개 검색으로" })).toBeTruthy();
    expect(screen.queryByText("ADMIN_CATALOG_MODE")).toBeNull();
  });

  it("loads additional cursor pages without replacing prior results", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(adminSession())
      .mockResolvedValueOnce(
        jsonResponse({ items: [songItem("first")], next_cursor: "opaque" })
      )
      .mockResolvedValueOnce(
        jsonResponse({ items: [songItem("second")], next_cursor: null })
      );
    vi.stubGlobal("fetch", fetcher);

    renderPage();
    await screen.findByRole("heading", { name: "표시 제목 first" });
    fireEvent.click(screen.getByRole("button", { name: "더 보기" }));
    await screen.findByRole("heading", { name: "표시 제목 second" });

    expect(
      screen.getByRole("heading", { name: "표시 제목 first" })
    ).toBeTruthy();
    expect(fetcher).toHaveBeenCalledWith(
      "/api/admin/songs?cursor=opaque",
      expect.any(Object)
    );
  });
});

function renderPage() {
  return render(
    <AuthProvider>
      <AdminSongListPage />
    </AuthProvider>
  );
}

function adminFetcher(listResponse: Response | Promise<Response>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    if (input.toString() === "/api/auth/get-session") {
      return adminSession();
    }
    return listResponse;
  });
}

function adminSession(): Response {
  return jsonResponse({
    user: { id: "admin-a", name: "Admin", is_admin: true }
  });
}

function songItem(id: string) {
  return {
    id,
    original_language: "ja",
    canonical_title: `Original ${id}`,
    display_title: `표시 제목 ${id}`,
    canonical_artist: `Artist ${id}`,
    provider_summary: [
      {
        provider_id: "tj",
        provider_name: "TJ",
        karaoke_number: "12345",
        version_info: "original",
        availability_status: "available"
      }
    ],
    updated_at: "2026-07-26T00:00:00.000Z"
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
