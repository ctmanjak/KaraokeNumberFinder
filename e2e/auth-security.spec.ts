import { request as playwrightRequest } from "@playwright/test";

import {
  appOrigin,
  completeMockGoogleFailure,
  completeMockGoogleLogin,
  controlHeaders,
  expect,
  loginDirectly,
  searchFor,
  test
} from "./fixtures";

test("public search transitions through mock Google login and survives reload/navigation", async ({
  page,
  catalog,
  users
}) => {
  const user = users.create("auth-success");
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Google 로그인", exact: true })
  ).toBeVisible();
  await searchFor(page, catalog.songs[0]);

  await completeMockGoogleLogin({
    page,
    users,
    user,
    trigger: page.getByRole("button", { name: "Google 로그인", exact: true })
  });
  await searchFor(page, catalog.songs[0]);

  await page.reload();
  await expect(
    page.getByRole("button", { name: `${user.name} 사용자 메뉴` })
  ).toBeVisible();
  await page.getByRole("button", { name: `${user.name} 사용자 메뉴` }).click();
  await page.getByRole("link", { name: "즐겨찾기", exact: true }).click();
  await expect(page.getByRole("heading", { name: "즐겨찾기" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: `${user.name} 사용자 메뉴` })
  ).toBeVisible();
});

for (const providerError of ["access_denied", "server_error"] as const) {
  test(`mock Google ${providerError} returns safely and leaves public search usable`, async ({
    page,
    catalog
  }) => {
    await page.goto("/");
    await searchFor(page, catalog.songs[0]);

    await completeMockGoogleFailure({
      page,
      providerError,
      trigger: page.getByRole("button", {
        name: "Google 로그인",
        exact: true
      })
    });

    await expect(page).toHaveURL(new RegExp(`^${escapeRegex(appOrigin())}/`));
    await searchFor(page, catalog.songs[0]);
    await expect(
      page.getByRole("button", { name: "Google 로그인", exact: true })
    ).toBeVisible();
  });
}

test("secure host cookie, public session JSON, logout, and revoked-cookie reuse obey the browser contract", async ({
  page,
  context,
  users
}) => {
  const user = users.create("cookie-security");
  const loginResponse = await loginDirectly(page, users, user);
  const setCookieHeaders = loginResponse
    .headersArray()
    .filter(({ name }) => name.toLowerCase() === "set-cookie")
    .map(({ value }) => value);
  expect(setCookieHeaders.length >= 1).toBe(true);
  expect(setCookieHeaders.every((value) => !/;\s*Domain=/iu.test(value))).toBe(
    true
  );

  const browserCookies = await context.cookies(appOrigin());
  const sessionCookie = browserCookies.find(
    ({ name }) => name === "__Host-knf.session_token"
  );
  expect(sessionCookie !== undefined).toBe(true);
  expect(sessionCookie?.secure).toBe(true);
  expect(sessionCookie?.httpOnly).toBe(true);
  expect(sessionCookie?.sameSite).toBe("Lax");
  expect(sessionCookie?.path).toBe("/");

  const publicSession = await page.request.get("/api/auth/get-session");
  expect(publicSession.status()).toBe(200);
  const publicSessionBody = (await publicSession.json()) as Record<
    string,
    unknown
  >;
  expect(Object.hasOwn(publicSessionBody, "session")).toBe(false);
  expect(
    /token|authorization.?code|secret/iu.test(JSON.stringify(publicSessionBody))
  ).toBe(false);

  await page.goto("/");
  await expect(
    page.getByRole("button", { name: `${user.name} 사용자 메뉴` })
  ).toBeVisible();
  const browserExposure = await page.evaluate(() => ({
    url: window.location.href,
    local: Object.entries(localStorage),
    session: Object.entries(sessionStorage),
    cookies: document.cookie
  }));
  expect(
    /session[_-]?token|authorization.?code|access[_-]?token|id[_-]?token|secret/iu.test(
      JSON.stringify(browserExposure)
    )
  ).toBe(false);

  const staleCookieHeader = `${sessionCookie?.name ?? ""}=${sessionCookie?.value ?? ""}`;
  await page.getByRole("button", { name: `${user.name} 사용자 메뉴` }).click();
  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Google 로그인", exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: `${user.name} 사용자 메뉴` })
  ).toHaveCount(0);

  const staleClient = await playwrightRequest.newContext({
    baseURL: appOrigin(),
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: { cookie: staleCookieHeader }
  });
  try {
    const protectedResponse = await staleClient.get("/api/favorites");
    expect(protectedResponse.status()).toBe(401);
    expect(protectedResponse.headers()["www-authenticate"]).toBe("Session");
    const body = (await protectedResponse.json()) as {
      error?: { code?: string };
    };
    expect(body.error?.code).toBe("UNAUTHENTICATED");
  } finally {
    await staleClient.dispose();
  }
});

test("open redirects are rejected and a second login rotates the previous browser session", async ({
  page,
  context,
  users
}) => {
  const invalidRedirect = await page.request.post("/api/auth/sign-in/social", {
    headers: {
      ...controlHeaders(),
      "content-type": "application/json"
    },
    data: { provider: "google", callbackURL: "https://evil.example/" }
  });
  expect(invalidRedirect.status()).toBe(400);
  expect(
    ((await invalidRedirect.json()) as { error?: { code?: string } }).error
      ?.code
  ).toBe("INVALID_CALLBACK_URL");

  const firstUser = users.create("rotation-a");
  const secondUser = users.create("rotation-b");
  await loginDirectly(page, users, firstUser);
  const firstCookie = (await context.cookies(appOrigin())).find(
    ({ name }) => name === "__Host-knf.session_token"
  );
  expect(firstCookie !== undefined).toBe(true);

  await loginDirectly(page, users, secondUser);
  const secondCookie = (await context.cookies(appOrigin())).find(
    ({ name }) => name === "__Host-knf.session_token"
  );
  expect(secondCookie !== undefined).toBe(true);
  expect(firstCookie?.value === secondCookie?.value).toBe(false);

  await page.goto("/");
  await expect(
    page.getByRole("button", { name: `${secondUser.name} 사용자 메뉴` })
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: `${firstUser.name} 사용자 메뉴` })
  ).toHaveCount(0);

  const previousSession = await playwrightRequest.newContext({
    baseURL: appOrigin(),
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: {
      cookie: `${firstCookie?.name ?? ""}=${firstCookie?.value ?? ""}`
    }
  });
  try {
    expect((await previousSession.get("/api/favorites")).status()).toBe(401);
  } finally {
    await previousSession.dispose();
  }
});

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
