import { randomUUID } from "node:crypto";
import {
  expect,
  test as base,
  type APIRequestContext,
  type APIResponse,
  type Locator,
  type Page
} from "@playwright/test";

export type E2ECatalog = Readonly<{
  songs: ReadonlyArray<{
    id: string;
    query: string;
    display_title: string;
  }>;
  providers: ReadonlyArray<{ id: string; name: string }>;
}>;

export type E2EUser = Readonly<{
  id: string;
  name: string;
}>;

type E2EUsers = Readonly<{
  create(label: string): E2EUser;
  login(
    request: APIRequestContext,
    user: E2EUser,
    oauthState?: string
  ): Promise<APIResponse>;
}>;

const baseURL = process.env.BETTER_AUTH_URL ?? "https://127.0.0.1:3443";

export const test = base.extend<{
  catalog: E2ECatalog;
  users: E2EUsers;
}>({
  catalog: async ({ request }, run) => {
    const response = await request.get("/api/e2e/control", {
      headers: controlHeaders()
    });
    expect(response.status()).toBe(200);
    const catalog = (await response.json()) as E2ECatalog;
    expect(catalog.songs.length >= 2).toBe(true);
    expect(catalog.providers.length >= 2).toBe(true);
    await run(catalog);
  },
  users: async ({ request }, run) => {
    const userIds = new Set<string>();
    await run({
      create(label) {
        const id = randomUUID();
        userIds.add(id);
        return { id, name: `E2E ${label} ${id.slice(0, 8)}` };
      },
      async login(apiRequest, user, oauthState) {
        const response = await apiRequest.post("/api/e2e/control", {
          headers: {
            ...controlHeaders(),
            "content-type": "application/json"
          },
          data: {
            action: "login",
            user_id: user.id,
            display_name: user.name,
            ...(oauthState === undefined ? {} : { oauth_state: oauthState })
          }
        });
        expect(response.status()).toBe(200);
        return response;
      }
    });

    if (userIds.size > 0) {
      const response = await request.delete("/api/e2e/control", {
        headers: {
          ...controlHeaders(),
          "content-type": "application/json"
        },
        data: { user_ids: [...userIds] }
      });
      expect(response.status()).toBe(200);
    }
  }
});

export { expect } from "@playwright/test";

export function controlHeaders(): Record<string, string> {
  return {
    origin: baseURL,
    "sec-fetch-site": "same-origin",
    "x-knf-e2e-test": "1"
  };
}

export function mutationHeaders(): Record<string, string> {
  return {
    origin: baseURL,
    "sec-fetch-site": "same-origin",
    "x-knf-request": "1",
    "content-type": "application/json"
  };
}

export async function loginDirectly(
  page: Page,
  users: E2EUsers,
  user: E2EUser
): Promise<APIResponse> {
  return users.login(page.request, user);
}

export async function completeMockGoogleLogin(options: {
  page: Page;
  users: E2EUsers;
  user: E2EUser;
  trigger: Locator;
  returnTo?: "/" | "/favorites" | "/settings";
}): Promise<APIResponse> {
  let oauthState: string | undefined;
  await options.page.setExtraHTTPHeaders({
    "x-forwarded-for": uniqueTestClientIP()
  });
  await options.page.route(
    "https://accounts.google.com/**",
    async (route) => {
      const authorizationURL = new URL(route.request().url());
      const state = authorizationURL.searchParams.get("state");
      expect(state !== null).toBe(true);
      oauthState = state ?? undefined;
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        headers: { "cache-control": "no-store" },
        body: "<!doctype html><title>Mock Google</title>"
      });
    },
    { times: 1 }
  );

  await triggerOAuthBoundary(options.page, options.trigger, () => oauthState);
  expect(oauthState).toBeDefined();
  const returnURL = new URL(options.returnTo ?? "/", baseURL).href;
  const loginResponse = await options.users.login(
    options.page.request,
    options.user,
    oauthState
  );
  await options.page.goto(returnURL);
  await expect(
    options.page.getByRole("button", {
      name: `${options.user.name} 사용자 메뉴`
    })
  ).toBeVisible();
  return loginResponse;
}

export async function completeMockGoogleFailure(options: {
  page: Page;
  trigger: Locator;
  providerError: "access_denied" | "server_error";
}): Promise<void> {
  let oauthState: string | undefined;
  let callbackURL: string | undefined;
  await options.page.setExtraHTTPHeaders({
    "x-forwarded-for": uniqueTestClientIP()
  });
  await options.page.route(
    "https://accounts.google.com/**",
    async (route) => {
      const authorizationURL = new URL(route.request().url());
      const state = authorizationURL.searchParams.get("state");
      expect(state !== null).toBe(true);
      oauthState = state ?? undefined;
      const callback = new URL("/api/auth/callback/google", baseURL);
      callback.searchParams.set("state", state ?? "");
      callback.searchParams.set("error", options.providerError);
      callbackURL = callback.href;
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        headers: { "cache-control": "no-store" },
        body: "<!doctype html><title>Mock Google</title>"
      });
    },
    { times: 1 }
  );

  await triggerOAuthBoundary(options.page, options.trigger, () => oauthState);
  if (callbackURL === undefined) {
    throw new Error("Mock Google callback was not captured.");
  }
  await options.page.goto(callbackURL);
  await expect(
    options.page.getByText("Google 로그인이 취소되었거나 완료되지 않았습니다.")
  ).toBeVisible();
  const finalURL = new URL(options.page.url());
  expect(finalURL.origin).toBe(baseURL);
  expect(finalURL.pathname).toBe("/");
  expect(finalURL.searchParams.get("auth_error")).toBe("OAUTH_FAILED");
}

async function triggerOAuthBoundary(
  page: Page,
  trigger: Locator,
  readState: () => string | undefined
): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await trigger.click();
    try {
      await expect.poll(readState, { timeout: 6_000 }).not.toBeUndefined();
      return;
    } catch (error) {
      if (attempt === 1) {
        throw error;
      }
      await expect(
        page.getByText(
          "로그인 요청을 시작하지 못했습니다. 현재 화면은 계속 사용할 수 있습니다."
        )
      ).toBeVisible();
    }
  }
}

function uniqueTestClientIP(): string {
  const suffix = (Number.parseInt(randomUUID().slice(0, 2), 16) % 254) + 1;
  return `192.0.2.${suffix}`;
}

export async function searchFor(
  page: Page,
  song: E2ECatalog["songs"][number]
): Promise<void> {
  await page.getByRole("searchbox", { name: "검색어" }).fill(song.query);
  await page.getByRole("button", { name: "검색", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: song.display_title }).first()
  ).toBeVisible();
}

export function appOrigin(): string {
  return baseURL;
}
