import type { APIResponse } from "@playwright/test";
import { expect, mutationHeaders, test } from "./fixtures";

test.skip(
  process.env.ADMIN_CATALOG_MODE !== "off",
  "This suite runs only in the isolated ADMIN_CATALOG_MODE=off server."
);

test("feature-off hides navigation and rejects direct page and API access fail-closed", async ({
  page,
  catalog,
  users
}) => {
  const songId = catalog.songs[0].id;
  const actor = users.create("admin-catalog-off");

  const guest = await page.request.get("/api/admin/songs");
  expect(guest.status()).toBe(401);
  expect((await guest.json()).error.code).toBe("UNAUTHENTICATED");

  await users.login(page.request, actor);
  const regularUser = await page.request.get("/api/admin/songs");
  expect(regularUser.status()).toBe(403);
  expect((await regularUser.json()).error.code).toBe("FORBIDDEN");

  await users.loginAdmin(page.request, actor);
  let accessRequestCount = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/admin/catalog-access") {
      accessRequestCount += 1;
    }
  });
  const menuAccess = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/admin/catalog-access"
  );
  await page.goto("/");
  expect((await menuAccess).status()).toBe(403);
  expect(accessRequestCount).toBe(1);

  await page.getByRole("button", { name: `${actor.name} 사용자 메뉴` }).click();
  await expect(page.getByRole("link", { name: "노래 관리" })).toHaveCount(0);
  await expect(page.getByText(/준비 중/u)).toHaveCount(0);
  await page.waitForTimeout(100);
  expect(accessRequestCount).toBe(1);
  await page.getByRole("button", { name: `${actor.name} 사용자 메뉴` }).click();
  await page.getByRole("button", { name: `${actor.name} 사용자 메뉴` }).click();
  expect(accessRequestCount).toBe(1);

  const pageResponse = await page.goto("/admin/songs");
  expect(pageResponse?.status()).toBe(403);
  await expect(
    page.getByRole("heading", {
      name: "관리자 카탈로그가 아직 활성화되지 않았습니다"
    })
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "홈으로" })).toBeVisible();
  await expect(page.getByRole("link", { name: "공개 검색으로" })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("ADMIN_CATALOG_MODE");

  const duplicate = await page.request.post(
    "/api/admin/songs/duplicate-check",
    {
      headers: mutationHeaders(),
      data: {
        canonical_title: "Feature Off Secret Title",
        canonical_artist: "Feature Off Secret Artist"
      }
    }
  );
  await expectFeatureOffResponse(duplicate);

  const create = await page.request.post("/api/admin/songs", {
    headers: mutationHeaders(),
    data: { canonical_title: "must-not-be-processed" }
  });
  await expectFeatureOffResponse(create);

  const update = await page.request.patch(
    `/api/admin/songs/${encodeURIComponent(songId)}`,
    {
      headers: mutationHeaders(),
      data: { expected_updated_at: "must-not-be-processed" }
    }
  );
  await expectFeatureOffResponse(update);
});

async function expectFeatureOffResponse(response: APIResponse) {
  expect(response.status()).toBe(403);
  const body = await response.json();
  expect(body).toEqual({
    error: {
      code: "ADMIN_CATALOG_NOT_ENABLED",
      message: expect.any(String),
      request_id: expect.any(String)
    }
  });
  expect(response.headers()["cache-control"]).toContain("no-store");
  expect(response.headers()["x-request-id"]).toBe(body.error.request_id);
  expect(JSON.stringify(body)).not.toMatch(
    /Feature Off Secret|must-not-be-processed|ADMIN_CATALOG_MODE/iu
  );
}
