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

  it("keeps a pristine form idle without field errors", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      if (input.toString() === "/api/auth/get-session") {
        return jsonResponse({
          user: { id: "admin-a", name: "Admin", is_admin: true }
        });
      }
      if (input.toString() === "/api/admin/songs/options") {
        return optionsResponse();
      }
      return jsonResponse({ error: { code: "NOT_FOUND" } }, 404);
    });
    vi.stubGlobal("fetch", fetcher);

    renderPage();

    expect(
      await screen.findByText("원제와 가수를 입력하면 중복을 확인합니다.")
    ).toBeTruthy();
    expect(screen.queryByText("곡 식별 입력을 확인해 주세요.")).toBeNull();
    expect(
      screen.getByLabelText("원제").getAttribute("aria-invalid")
    ).toBeNull();
    expect(
      screen.getByLabelText("표시 제목").getAttribute("aria-invalid")
    ).toBeNull();
    expect(
      screen.getByLabelText("가수").getAttribute("aria-invalid")
    ).toBeNull();
  });

  it("loads dynamic options and submits one atomic song request", async () => {
    const navigate = vi.fn();
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
              karaoke_entry_count: 1,
              created_counts: {
                songs: 1,
                administrator_aliases: 0,
                karaoke_entries: 1
              }
            },
            201
          );
        }
        if (
          url === "/api/admin/songs/duplicate-check" &&
          init?.method === "POST"
        ) {
          return jsonResponse({ classification: "none", candidates: [] });
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

    renderPage(navigate);
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
    fireEvent.change(screen.getByLabelText("마지막 확인일"), {
      target: { value: "2026-07-22" }
    });
    fireEvent.change(screen.getByLabelText("제공사 출처명"), {
      target: { value: "TJ catalog" }
    });
    expect(await screen.findByText("중복 후보가 없습니다.")).toBeTruthy();
    const createButton = screen.getByRole("button", { name: "노래 추가" });
    fireEvent.click(createButton);
    fireEvent.click(createButton);

    await vi.waitFor(() => {
      expect(navigate).toHaveBeenCalledWith("/admin/songs/song-a");
    });
    expect(
      fetcher.mock.calls.filter(
        ([input, init]) =>
          input.toString() === "/api/admin/songs" && init?.method === "POST"
      )
    ).toHaveLength(1);
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
          availability_status: "available",
          last_verified_at: "2026-07-22",
          source_name: "TJ catalog",
          source_url: null,
          verification_note: null
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
        if (
          url === "/api/admin/songs/duplicate-check" &&
          init?.method === "POST"
        ) {
          return jsonResponse({ classification: "none", candidates: [] });
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
    fireEvent.change(screen.getByLabelText("마지막 확인일"), {
      target: { value: "2026-07-22" }
    });
    fireEvent.change(screen.getByLabelText("제공사 출처명"), {
      target: { value: "TJ catalog" }
    });
    expect(await screen.findByText("중복 후보가 없습니다.")).toBeTruthy();
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

  it("requires one acknowledgement for all possible candidates and resets it when candidate IDs change", async () => {
    let duplicateCall = 0;
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url === "/api/auth/get-session") {
        return jsonResponse({
          user: { id: "admin-a", name: "Admin", is_admin: true }
        });
      }
      if (url === "/api/admin/songs/options") return optionsResponse();
      if (url === "/api/admin/songs/duplicate-check") {
        duplicateCall += 1;
        return jsonResponse({
          classification: "possible",
          candidates: [candidate(duplicateCall === 1 ? "song-old" : "song-new")]
        });
      }
      return jsonResponse({ error: { code: "NOT_FOUND" } }, 404);
    });
    vi.stubGlobal("fetch", fetcher);

    renderPage();
    await fillIdentity();
    expect(
      await screen.findByRole("heading", { name: "중복 가능 후보" })
    ).toBeTruthy();
    const link = screen.getByRole("link", {
      name: "레몬 기존 곡 열기 (새 탭)"
    });
    expect(link.getAttribute("href")).toBe("/admin/songs/song-old");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener");
    const checkbox = screen.getByRole("checkbox", {
      name: "표시된 후보를 모두 확인했으며 새 곡 추가"
    }) as HTMLInputElement;
    expect(
      (
        screen.getByRole("button", {
          name: "노래 추가"
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(true);

    fireEvent.change(screen.getByLabelText("원제"), {
      target: { value: "Lemon changed" }
    });
    await vi.waitFor(
      () => {
        expect(
          screen
            .getByRole("link", {
              name: "레몬 기존 곡 열기 (새 탭)"
            })
            .getAttribute("href")
        ).toBe("/admin/songs/song-new");
      },
      { timeout: 2_000 }
    );
    expect(
      (
        screen.getByRole("checkbox", {
          name: "표시된 후보를 모두 확인했으며 새 곡 추가"
        }) as HTMLInputElement
      ).checked
    ).toBe(false);
  });

  it("blocks exact candidates without showing an acknowledgement", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url === "/api/auth/get-session") {
        return jsonResponse({
          user: { id: "admin-a", name: "Admin", is_admin: true }
        });
      }
      if (url === "/api/admin/songs/options") return optionsResponse();
      if (url === "/api/admin/songs/duplicate-check") {
        return jsonResponse({
          classification: "exact",
          candidates: [candidate("song-exact")]
        });
      }
      return jsonResponse({ error: { code: "NOT_FOUND" } }, 404);
    });
    vi.stubGlobal("fetch", fetcher);

    renderPage();
    await fillIdentity();
    expect(
      await screen.findByRole("heading", {
        name: "동일 곡이 이미 있습니다"
      })
    ).toBeTruthy();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(
      (
        screen.getByRole("button", {
          name: "노래 추가"
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
  });

  it("shows final possible candidates and resubmits their exact acknowledgement set", async () => {
    const navigate = vi.fn();
    let createCall = 0;
    const fetcher = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = input.toString();
        if (url === "/api/auth/get-session") {
          return jsonResponse({
            user: { id: "admin-a", name: "Admin", is_admin: true }
          });
        }
        if (url === "/api/admin/songs/options") return optionsResponse();
        if (url === "/api/admin/songs/duplicate-check") {
          return jsonResponse({ classification: "none", candidates: [] });
        }
        if (url === "/api/admin/songs" && init?.method === "POST") {
          createCall += 1;
          if (createCall === 1) {
            return jsonResponse(
              {
                error: {
                  code: "POSSIBLE_DUPLICATE_CONFIRMATION_REQUIRED",
                  message: "Confirm the latest candidates.",
                  details: { candidates: [candidate("song-final-possible")] }
                }
              },
              409
            );
          }
          return jsonResponse(
            {
              song: {
                id: "song-created",
                display_title: "레몬",
                canonical_artist: "米津玄師"
              },
              alias_count: 3,
              karaoke_entry_count: 1,
              created_counts: {
                songs: 1,
                administrator_aliases: 0,
                karaoke_entries: 1
              }
            },
            201
          );
        }
        return jsonResponse({ error: { code: "NOT_FOUND" } }, 404);
      }
    );
    vi.stubGlobal("fetch", fetcher);

    renderPage(navigate);
    await fillIdentity();
    await fillCreateFields();
    expect(await screen.findByText("중복 후보가 없습니다.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "노래 추가" }));

    expect(
      await screen.findByRole("heading", { name: "중복 가능 후보" })
    ).toBeTruthy();
    expect(
      screen.getByRole("link", {
        name: "레몬 기존 곡 열기 (새 탭)"
      })
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "표시된 후보를 모두 확인했으며 새 곡 추가"
      })
    );
    fireEvent.click(screen.getByRole("button", { name: "다시 생성" }));

    await vi.waitFor(() => {
      expect(navigate).toHaveBeenCalledWith("/admin/songs/song-created");
    });
    const createBodies = fetcher.mock.calls
      .filter(
        ([input, init]) =>
          input.toString() === "/api/admin/songs" && init?.method === "POST"
      )
      .map(([, init]) => JSON.parse(String(init?.body)));
    expect(createBodies).toHaveLength(2);
    expect(createBodies[0]).not.toHaveProperty(
      "possible_duplicate_acknowledged_song_ids"
    );
    expect({
      original_language: createBodies[1].original_language,
      canonical_title: createBodies[1].canonical_title,
      display_title: createBodies[1].display_title,
      canonical_artist: createBodies[1].canonical_artist
    }).toEqual({
      original_language: createBodies[0].original_language,
      canonical_title: createBodies[0].canonical_title,
      display_title: createBodies[0].display_title,
      canonical_artist: createBodies[0].canonical_artist
    });
    expect(createBodies[1]).toMatchObject({
      possible_duplicate_acknowledged_song_ids: ["song-final-possible"]
    });
  });

  it("does not replay an ambiguous POST and checks the original snapshot before showing an exact result", async () => {
    let duplicateCall = 0;
    const fetcher = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = input.toString();
        if (url === "/api/auth/get-session") {
          return jsonResponse({
            user: { id: "admin-a", name: "Admin", is_admin: true }
          });
        }
        if (url === "/api/admin/songs/options") return optionsResponse();
        if (url === "/api/admin/songs/duplicate-check") {
          duplicateCall += 1;
          return duplicateCall === 1
            ? jsonResponse({ classification: "none", candidates: [] })
            : jsonResponse({
                classification: "exact",
                candidates: [candidate("song-after-ambiguous")]
              });
        }
        if (url === "/api/admin/songs" && init?.method === "POST") {
          return jsonResponse(
            {
              error: {
                code: "DATABASE_TIMEOUT",
                message: "Unknown commit state."
              }
            },
            503
          );
        }
        return jsonResponse({ error: { code: "NOT_FOUND" } }, 404);
      }
    );
    vi.stubGlobal("fetch", fetcher);

    renderPage();
    await fillIdentity();
    await fillCreateFields();
    expect(await screen.findByText("중복 후보가 없습니다.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "노래 추가" }));

    expect(
      await screen.findByText(/방금 요청의 성공 여부는 확정할 수 없습니다/)
    ).toBeTruthy();
    expect(
      screen
        .getByRole("link", {
          name: "레몬 기존 곡 열기 (새 탭)"
        })
        .getAttribute("href")
    ).toBe("/admin/songs/song-after-ambiguous");
    expect(
      fetcher.mock.calls.filter(
        ([input, init]) =>
          input.toString() === "/api/admin/songs" && init?.method === "POST"
      )
    ).toHaveLength(1);
    expect(duplicateCall).toBe(2);
  });
});

function renderPage(navigateToDetail?: (url: string) => void) {
  return render(
    <AuthProvider>
      <AdminSongPage navigateToDetail={navigateToDetail} />
    </AuthProvider>
  );
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function optionsResponse() {
  return jsonResponse({
    alias_types: ["translated_title", "alternate_spelling"],
    availability_statuses: [
      "available",
      "not_available",
      "temporarily_unavailable",
      "unknown"
    ],
    providers: [{ id: "tj", name: "TJ", country: "KR" }]
  });
}

async function fillIdentity() {
  fireEvent.change(await screen.findByLabelText("원제"), {
    target: { value: "Lemon" }
  });
  fireEvent.change(screen.getByLabelText("표시 제목"), {
    target: { value: "레몬" }
  });
  fireEvent.change(screen.getByLabelText("가수"), {
    target: { value: "米津玄師" }
  });
}

async function fillCreateFields() {
  fireEvent.change(screen.getByLabelText("출처명"), {
    target: { value: "Official catalog" }
  });
  fireEvent.change(screen.getByLabelText("예약 번호"), {
    target: { value: "28822" }
  });
  fireEvent.change(screen.getByLabelText("마지막 확인일"), {
    target: { value: "2026-07-22" }
  });
  fireEvent.change(screen.getByLabelText("제공사 출처명"), {
    target: { value: "TJ catalog" }
  });
}

function candidate(id: string) {
  return {
    id,
    display_title: "레몬",
    canonical_title: "Lemon",
    canonical_artist: "米津玄師",
    original_language: "ja",
    release_year: 2018,
    tie_in: null,
    provider_summary: [
      {
        provider_id: "tj",
        provider_name: "TJ",
        karaoke_number: "28822",
        version_info: ""
      }
    ],
    match_evidence: [
      {
        role: "title",
        strength: "exact",
        input_field: "canonical_title",
        candidate_field: "song.canonical_title",
        matched_value: "Lemon"
      }
    ],
    admin_path: `/admin/songs/${id}`
  };
}
