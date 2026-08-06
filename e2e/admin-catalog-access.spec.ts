import { expect, test } from "./fixtures";

test.skip(
  process.env.ADMIN_CATALOG_MODE === "off",
  "This suite requires the administrator catalog to be enabled."
);

test("administrator catalog access is prefetched and reused by the user menu", async ({
  page,
  users
}) => {
  const actor = users.create("admin-catalog-access");
  await users.loginAdmin(page.request, actor);

  let accessRequestCount = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/admin/catalog-access") {
      accessRequestCount += 1;
    }
  });
  const prefetch = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/admin/catalog-access"
  );

  await page.goto("/");
  const prefetchResponse = await prefetch;
  expect(prefetchResponse.status()).toBe(200);
  expect(prefetchResponse.headers()["cache-control"]).toContain("no-store");
  expect(accessRequestCount).toBe(1);

  const menuButton = page.getByRole("button", {
    name: `${actor.name} 사용자 메뉴`
  });
  await menuButton.click();
  await expect(page.getByRole("link", { name: "설정" })).toBeVisible();
  await expect(page.getByRole("link", { name: "노래 관리" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "로그아웃", exact: true })
  ).toBeVisible();
  await page.waitForTimeout(100);
  expect(accessRequestCount).toBe(1);

  await menuButton.click();
  await menuButton.click();
  await expect(page.getByRole("link", { name: "노래 관리" })).toBeVisible();
  expect(accessRequestCount).toBe(1);

  await menuButton.click();
  await page.getByRole("link", { name: "즐겨찾기", exact: true }).click();
  await expect(page.getByRole("heading", { name: "즐겨찾기" })).toBeVisible();
  expect(accessRequestCount).toBe(1);

  await menuButton.click();
  await expect(page.getByRole("link", { name: "노래 관리" })).toBeVisible();
  expect(accessRequestCount).toBe(1);
});
