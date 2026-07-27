// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "@/components/auth/AuthProvider";
import { AdminSongPage } from "./AdminSongPage";

describe("admin song page", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("denies a regular authenticated user without loading admin data", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({ user: { id: "user-a", is_admin: false } })
    );
    vi.stubGlobal("fetch", fetcher);

    renderPage();

    expect(
      await screen.findByText("관리자만 접근할 수 있습니다.")
    ).toBeTruthy();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("loads dynamic options and submits one atomic song request", async () => {
    const fetcher = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = input.toString();
        if (url === "/api/auth/get-session") {
          return jsonResponse({
            user: { id: "admin-a", name: "Admin", is_admin: true }
          });
        }
        if (url === "/api/admin/songs" && init?.method === "POST") {
          return jsonResponse(
            {
              song: {
                id: "song-a",
                display_title: "레몬",
                canonical_artist: "米津玄師"
              },
              alias_count: 3,
              karaoke_entry_count: 1
            },
            201
          );
        }
        if (url !== "/api/admin/songs/options") {
          return jsonResponse({ error: { code: "NOT_FOUND" } }, 404);
        }
        return jsonResponse({
          alias_types: [
            "canonical_title",
            "display_title",
            "artist",
            "translated_title"
          ],
          availability_statuses: ["available", "not_available"],
          providers: [{ id: "tj", name: "TJ", country: "KR" }]
        });
      }
    );
    vi.stubGlobal("fetch", fetcher);

    renderPage();
    fireEvent.change(await screen.findByLabelText("원제"), {
      target: { value: "Lemon" }
    });
    fireEvent.change(screen.getByLabelText("표시 제목"), {
      target: { value: "레몬" }
    });
    fireEvent.change(screen.getByLabelText("가수"), {
      target: { value: "米津玄師" }
    });
    fireEvent.change(screen.getByLabelText("출처명"), {
      target: { value: "Official catalog" }
    });
    fireEvent.change(screen.getByLabelText("예약 번호"), {
      target: { value: "28822" }
    });
    fireEvent.click(screen.getByRole("button", { name: "노래 추가" }));

    expect(
      await screen.findByText(/레몬 · 米津玄師.*추가했습니다/)
    ).toBeTruthy();
    const postCall = fetcher.mock.calls.find(
      ([input, init]) =>
        input.toString() === "/api/admin/songs" && init?.method === "POST"
    );
    expect(postCall).toBeDefined();
    expect(fetcher).toHaveBeenCalledWith(
      "/api/admin/songs/options",
      expect.objectContaining({ cache: "no-store" })
    );
    const init = postCall?.[1];
    expect(init?.headers).toMatchObject({ "x-knf-request": "1" });
    expect(JSON.parse(String(init?.body))).toMatchObject({
      original_language: "ja",
      canonical_title: "Lemon",
      display_title: "레몬",
      canonical_artist: "米津玄師",
      source_name: "Official catalog",
      aliases: [],
      karaoke_entries: [
        {
          provider_id: "tj",
          karaoke_number: "28822",
          availability_status: "available"
        }
      ]
    });
  });

  it("preserves input and locks saving when the catalog is disabled during submission", async () => {
    const fetcher = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = input.toString();
        if (url === "/api/auth/get-session") {
          return jsonResponse({
            user: { id: "admin-a", name: "Admin", is_admin: true }
          });
        }
        if (url === "/api/admin/songs/options") {
          return jsonResponse({
            alias_types: ["canonical_title", "display_title", "artist"],
            availability_statuses: ["available", "not_available"],
            providers: [{ id: "tj", name: "TJ", country: "KR" }]
          });
        }
        if (url === "/api/admin/songs" && init?.method === "POST") {
          return jsonResponse(
            {
              error: {
                code: "ADMIN_CATALOG_NOT_ENABLED",
                message: "Catalog access is unavailable.",
                request_id: "request-off"
              }
            },
            403
          );
        }
        return jsonResponse({ error: { code: "NOT_FOUND" } }, 404);
      }
    );
    vi.stubGlobal("fetch", fetcher);

    renderPage();
    const canonicalTitle = await screen.findByLabelText("원제");
    fireEvent.change(canonicalTitle, { target: { value: "Lemon" } });
    fireEvent.change(screen.getByLabelText("표시 제목"), {
      target: { value: "레몬" }
    });
    fireEvent.change(screen.getByLabelText("가수"), {
      target: { value: "米津玄師" }
    });
    fireEvent.change(screen.getByLabelText("출처명"), {
      target: { value: "Official catalog" }
    });
    fireEvent.change(screen.getByLabelText("예약 번호"), {
      target: { value: "28822" }
    });
    fireEvent.click(screen.getByRole("button", { name: "노래 추가" }));

    expect(
      await screen.findByRole("heading", {
        name: "관리자 카탈로그가 아직 활성화되지 않았습니다"
      })
    ).toBeTruthy();
    expect((canonicalTitle as HTMLInputElement).value).toBe("Lemon");
    expect(
      (canonicalTitle.closest("fieldset") as HTMLFieldSetElement).disabled
    ).toBe(true);
    expect(
      (
        screen.getByRole("button", {
          name: "노래 추가"
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
    expect(screen.getByRole("link", { name: "홈으로" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "공개 검색으로" })).toBeTruthy();
    expect(
      fetcher.mock.calls.filter(
        ([input, init]) =>
          input.toString() === "/api/admin/songs" && init?.method === "POST"
      )
    ).toHaveLength(1);
  });

  it("shows activation guidance if options are denied after page authorization", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url === "/api/auth/get-session") {
        return jsonResponse({
          user: { id: "admin-a", name: "Admin", is_admin: true }
        });
      }
      if (url === "/api/admin/songs/options") {
        return jsonResponse(
          {
            error: {
              code: "ADMIN_CATALOG_NOT_ENABLED",
              message: "Catalog access is unavailable.",
              request_id: "request-off"
            }
          },
          403
        );
      }
      return jsonResponse({ error: { code: "NOT_FOUND" } }, 404);
    });
    vi.stubGlobal("fetch", fetcher);

    renderPage();

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "관리자 카탈로그가 아직 활성화되지 않았습니다"
      })
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "홈으로" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "공개 검색으로" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "노래 추가" })).toBeNull();
    expect(screen.queryByText("ADMIN_CATALOG_MODE")).toBeNull();
  });
});

function renderPage() {
  return render(
    <AuthProvider>
      <AdminSongPage />
    </AuthProvider>
  );
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  } as Response;
}
