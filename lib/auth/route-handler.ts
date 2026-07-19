import { randomBytes } from "node:crypto";

import type { OAuthFlowStore } from "./oauth-flow-store";
import { OAUTH_NONCE_STATE_KEY } from "./google-profile";
import {
  AUTH_BASE_PATH,
  GOOGLE_CALLBACK_PATH,
  OAUTH_STATE_TTL_SECONDS,
  type AuthCookiePolicy
} from "./policy";
import { parseSafeAuthCallbackPath } from "./redirect";

const GOOGLE_AUTHORIZATION_ORIGIN = "https://accounts.google.com";
const GOOGLE_AUTHORIZATION_PATH = "/o/oauth2/v2/auth";
const GOOGLE_SCOPES = new Set(["openid", "email", "profile"]);

export type AuthFrameworkHandlers = {
  GET(request: Request): Promise<Response>;
  POST(request: Request): Promise<Response>;
};

export type AuthRouteDependencies = {
  framework: AuthFrameworkHandlers;
  flowStore: OAuthFlowStore;
  baseOrigin: string;
  googleClientId: string;
  googleCallbackURL: string;
  cookie: AuthCookiePolicy;
  now?: () => Date;
  generateNonce?: () => string;
  readExistingSessionToken?: (request: Request) => Promise<string | null>;
  revokeSessionToken?: (token: string) => Promise<void>;
  writeSafeLog?: (event: "callback" | "logout" | "session") => void;
};

export function createAuthRouteHandlers(
  dependencies: AuthRouteDependencies
): AuthFrameworkHandlers {
  const now = dependencies.now ?? (() => new Date());
  const generateNonce =
    dependencies.generateNonce ?? (() => randomBytes(32).toString("base64url"));

  return {
    async GET(request) {
      const pathname = new URL(request.url).pathname;

      if (pathname === GOOGLE_CALLBACK_PATH) {
        return handleGoogleCallback(request, dependencies, now);
      }

      if (pathname === `${AUTH_BASE_PATH}/get-session`) {
        return handleGetSession(request, dependencies, now);
      }

      return notFoundResponse();
    },
    async POST(request) {
      const pathname = new URL(request.url).pathname;

      if (pathname === `${AUTH_BASE_PATH}/sign-in/social`) {
        return handleGoogleSignInStart(
          request,
          dependencies,
          generateNonce,
          now
        );
      }

      if (pathname === `${AUTH_BASE_PATH}/sign-out`) {
        return handleSignOut(request, dependencies);
      }

      return notFoundResponse();
    }
  };
}

async function handleGoogleSignInStart(
  request: Request,
  dependencies: AuthRouteDependencies,
  generateNonce: () => string,
  now: () => Date
): Promise<Response> {
  const body = await readJsonObject(request);
  if (body === null) {
    return jsonError(
      400,
      "INVALID_REQUEST",
      "A JSON request body is required."
    );
  }

  const callbackURL = parseSafeAuthCallbackPath(body.callbackURL);
  if (callbackURL === null) {
    return jsonError(
      400,
      "INVALID_CALLBACK_URL",
      "The callback URL is not allowed."
    );
  }

  if (
    body.provider !== "google" ||
    body.idToken !== undefined ||
    body.scopes !== undefined ||
    body.additionalData !== undefined ||
    body.loginHint !== undefined ||
    (body.disableRedirect !== undefined && body.disableRedirect !== false)
  ) {
    return jsonError(
      400,
      "INVALID_AUTH_REQUEST",
      "Only the Google authorization code flow is supported."
    );
  }

  const nonce = generateNonce();
  if (nonce.length < 32) {
    return jsonError(503, "AUTH_UNAVAILABLE", "Authentication is unavailable.");
  }

  const forwardedRequest = requestWithJsonBody(request, {
    provider: "google",
    callbackURL,
    errorCallbackURL: "/",
    newUserCallbackURL: callbackURL,
    disableRedirect: false,
    additionalData: { [OAUTH_NONCE_STATE_KEY]: nonce }
  });

  let response: Response;
  try {
    response = await dependencies.framework.POST(forwardedRequest);
  } catch {
    return jsonError(503, "AUTH_UNAVAILABLE", "Authentication is unavailable.");
  }

  if (!response.ok) {
    return jsonError(
      response.status >= 500 ? 503 : response.status,
      "AUTH_REQUEST_REJECTED",
      "The authentication request was rejected."
    );
  }

  const rewritten = await addNonceToAuthorizationResponse(
    response,
    nonce,
    dependencies
  );
  if (rewritten === null) {
    return jsonError(503, "AUTH_UNAVAILABLE", "Authentication is unavailable.");
  }

  const state = rewritten.authorizationURL.searchParams.get("state");
  if (state === null) {
    return jsonError(503, "AUTH_UNAVAILABLE", "Authentication is unavailable.");
  }

  try {
    await dependencies.flowStore.register(
      state,
      new Date(now().getTime() + OAUTH_STATE_TTL_SECONDS * 1_000)
    );
  } catch {
    await dependencies.flowStore.abort(state).catch(() => undefined);
    return jsonError(503, "AUTH_UNAVAILABLE", "Authentication is unavailable.");
  }

  return rewritten.response;
}

async function addNonceToAuthorizationResponse(
  response: Response,
  nonce: string,
  dependencies: AuthRouteDependencies
): Promise<{ response: Response; authorizationURL: URL } | null> {
  let json: Record<string, unknown> | null = null;
  try {
    const parsed = (await response.clone().json()) as unknown;
    if (isRecord(parsed)) {
      json = parsed;
    }
  } catch {
    json = null;
  }

  const rawURL =
    typeof json?.url === "string" ? json.url : response.headers.get("location");
  if (rawURL === null) {
    return null;
  }

  let authorizationURL: URL;
  try {
    authorizationURL = new URL(rawURL);
  } catch {
    return null;
  }

  if (!isExpectedGoogleAuthorizationURL(authorizationURL, dependencies)) {
    return null;
  }

  authorizationURL.searchParams.set("nonce", nonce);
  const headers = cloneHeaders(response.headers);
  headers.set("location", authorizationURL.toString());
  headers.set("cache-control", "no-store");
  headers.delete("content-length");
  headers.set("content-type", "application/json; charset=utf-8");

  return {
    authorizationURL,
    response: new Response(
      JSON.stringify({ url: authorizationURL.toString(), redirect: true }),
      {
        status: 200,
        headers
      }
    )
  };
}

function isExpectedGoogleAuthorizationURL(
  url: URL,
  dependencies: AuthRouteDependencies
): boolean {
  const scopes = new Set((url.searchParams.get("scope") ?? "").split(" "));

  return (
    url.origin === GOOGLE_AUTHORIZATION_ORIGIN &&
    url.pathname === GOOGLE_AUTHORIZATION_PATH &&
    url.searchParams.get("response_type") === "code" &&
    url.searchParams.get("client_id") === dependencies.googleClientId &&
    url.searchParams.get("redirect_uri") === dependencies.googleCallbackURL &&
    url.searchParams.get("code_challenge_method") === "S256" &&
    (url.searchParams.get("code_challenge")?.length ?? 0) >= 43 &&
    (url.searchParams.get("state")?.length ?? 0) >= 32 &&
    url.searchParams.get("access_type") === null &&
    scopes.size === GOOGLE_SCOPES.size &&
    [...GOOGLE_SCOPES].every((scope) => scopes.has(scope))
  );
}

async function handleGoogleCallback(
  request: Request,
  dependencies: AuthRouteDependencies,
  now: () => Date
): Promise<Response> {
  const state = new URL(request.url).searchParams.get("state");
  if (state === null || state.length > 512) {
    return oauthFailureResponse(dependencies.cookie, "OAUTH_FAILED");
  }

  let consumed = false;
  try {
    consumed = await dependencies.flowStore.consume(state, now());
  } catch {
    dependencies.writeSafeLog?.("callback");
  }

  if (!consumed) {
    return oauthFailureResponse(dependencies.cookie, "OAUTH_FAILED");
  }

  let previousSessionToken: string | null = null;
  try {
    previousSessionToken =
      (await dependencies.readExistingSessionToken?.(request)) ?? null;
  } catch {
    dependencies.writeSafeLog?.("session");
    await abortOAuthFlow(state, dependencies);
    return oauthFailureResponse(dependencies.cookie, "OAUTH_FAILED");
  }

  if (previousSessionToken !== null) {
    if (dependencies.revokeSessionToken === undefined) {
      dependencies.writeSafeLog?.("session");
      await abortOAuthFlow(state, dependencies);
      return oauthFailureResponse(dependencies.cookie, "OAUTH_FAILED");
    }

    try {
      await dependencies.revokeSessionToken(previousSessionToken);
    } catch {
      dependencies.writeSafeLog?.("session");
      await abortOAuthFlow(state, dependencies);
      return oauthFailureResponse(dependencies.cookie, "OAUTH_FAILED");
    }
  }

  let response: Response;
  try {
    response = await dependencies.framework.GET(request);
  } catch {
    await abortOAuthFlow(state, dependencies);
    dependencies.writeSafeLog?.("callback");
    return oauthFailureResponse(dependencies.cookie, "OAUTH_FAILED");
  }

  const location = response.headers.get("location");
  const errorCode = callbackErrorCode(location, dependencies.baseOrigin);
  const issuedSession = hasIssuedCookie(
    response.headers,
    dependencies.cookie.sessionCookieName
  );

  if (errorCode !== null || !issuedSession || location === null) {
    return oauthFailureResponse(
      dependencies.cookie,
      errorCode === "account_not_linked" ? "ACCOUNT_CONFLICT" : "OAUTH_FAILED"
    );
  }

  const safeLocation = safeLocationPath(location, dependencies.baseOrigin);
  if (safeLocation === null) {
    dependencies.writeSafeLog?.("callback");
    return oauthFailureResponse(dependencies.cookie, "OAUTH_FAILED");
  }

  const headers = cloneHeaders(response.headers);
  headers.set("location", safeLocation);
  headers.set("cache-control", "no-store");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

async function abortOAuthFlow(
  state: string,
  dependencies: AuthRouteDependencies
): Promise<void> {
  try {
    await dependencies.flowStore.abort(state);
  } catch {
    dependencies.writeSafeLog?.("callback");
  }
}

async function handleGetSession(
  request: Request,
  dependencies: AuthRouteDependencies,
  now: () => Date
): Promise<Response> {
  let response: Response;
  try {
    response = await dependencies.framework.GET(request);
  } catch {
    dependencies.writeSafeLog?.("session");
    return jsonError(503, "AUTH_UNAVAILABLE", "Authentication is unavailable.");
  }

  if (!response.ok) {
    return jsonError(503, "AUTH_UNAVAILABLE", "Authentication is unavailable.");
  }

  let body: unknown;
  try {
    body = await response.clone().json();
  } catch {
    return jsonError(503, "AUTH_UNAVAILABLE", "Authentication is unavailable.");
  }

  if (isRecord(body) && isRecord(body.session)) {
    delete body.session.token;
  }

  const headers = cloneHeaders(response.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");

  const expiresAt =
    isRecord(body) &&
    isRecord(body.session) &&
    typeof body.session.expiresAt === "string"
      ? new Date(body.session.expiresAt)
      : null;
  if (expiresAt !== null && Number.isFinite(expiresAt.getTime())) {
    capIssuedSessionCookie(
      headers,
      dependencies.cookie.sessionCookieName,
      expiresAt,
      now()
    );
  }

  return new Response(JSON.stringify(body), {
    status: response.status,
    headers
  });
}

async function handleSignOut(
  request: Request,
  dependencies: AuthRouteDependencies
): Promise<Response> {
  try {
    const response = await dependencies.framework.POST(request);
    const headers = cloneHeaders(response.headers);
    headers.set("content-type", "application/json; charset=utf-8");
    headers.set("cache-control", "no-store");
    return new Response(JSON.stringify({ success: true }), {
      status: response.ok ? 200 : response.status,
      headers
    });
  } catch {
    dependencies.writeSafeLog?.("logout");
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "set-cookie": expiredCookie(
          dependencies.cookie.sessionCookieName,
          dependencies.cookie.secure
        )
      }
    });
  }
}

function callbackErrorCode(
  location: string | null,
  baseOrigin: string
): string | null {
  if (location === null) {
    return "missing_redirect";
  }

  try {
    return new URL(location, baseOrigin).searchParams.get("error");
  } catch {
    return "invalid_redirect";
  }
}

function safeLocationPath(location: string, baseOrigin: string): string | null {
  let url: URL;
  try {
    url = new URL(location, baseOrigin);
  } catch {
    return null;
  }

  if (url.origin !== baseOrigin || url.search !== "" || url.hash !== "") {
    return null;
  }

  return parseSafeAuthCallbackPath(url.pathname);
}

function oauthFailureResponse(
  cookie: AuthCookiePolicy,
  code: "ACCOUNT_CONFLICT" | "OAUTH_FAILED"
): Response {
  return new Response(null, {
    status: 303,
    headers: {
      location: `/?auth_error=${code}`,
      "cache-control": "no-store",
      "set-cookie": expiredCookie(cookie.stateCookieName, cookie.secure)
    }
  });
}

function expiredCookie(name: string, secure: boolean): string {
  return `${name}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}

function capIssuedSessionCookie(
  headers: Headers,
  cookieName: string,
  expiresAt: Date,
  now: Date
): void {
  const maxAge = Math.max(
    0,
    Math.floor((expiresAt.getTime() - now.getTime()) / 1_000)
  );
  const expires = expiresAt.toUTCString();
  replaceSetCookies(headers, (cookie) => {
    if (!cookie.startsWith(`${cookieName}=`)) {
      return cookie;
    }

    const withMaxAge = /;\s*Max-Age=[^;]*/iu.test(cookie)
      ? cookie.replace(/;\s*Max-Age=[^;]*/iu, `; Max-Age=${maxAge}`)
      : `${cookie}; Max-Age=${maxAge}`;
    return /;\s*Expires=[^;]*/iu.test(withMaxAge)
      ? withMaxAge.replace(/;\s*Expires=[^;]*/iu, `; Expires=${expires}`)
      : `${withMaxAge}; Expires=${expires}`;
  });
}

function hasIssuedCookie(headers: Headers, cookieName: string): boolean {
  return getSetCookies(headers).some(
    (cookie) =>
      cookie.startsWith(`${cookieName}=`) &&
      !cookie.startsWith(`${cookieName}=;`) &&
      !/;\s*Max-Age=0(?:;|$)/iu.test(cookie)
  );
}

function cloneHeaders(source: Headers): Headers {
  const headers = new Headers(source);
  const cookies = getSetCookies(source);
  if (cookies.length > 0) {
    headers.delete("set-cookie");
    for (const cookie of cookies) {
      headers.append("set-cookie", cookie);
    }
  }
  return headers;
}

function replaceSetCookies(
  headers: Headers,
  transform: (cookie: string) => string
): void {
  const cookies = getSetCookies(headers);
  if (cookies.length === 0) {
    return;
  }

  headers.delete("set-cookie");
  for (const cookie of cookies) {
    headers.append("set-cookie", transform(cookie));
  }
}

function getSetCookies(headers: Headers): string[] {
  const extended = headers as Headers & { getSetCookie?: () => string[] };
  if (typeof extended.getSetCookie === "function") {
    return extended.getSetCookie();
  }

  const value = headers.get("set-cookie");
  return value === null ? [] : [value];
}

async function readJsonObject(
  request: Request
): Promise<Record<string, unknown> | null> {
  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  ) {
    return null;
  }

  try {
    const value = (await request.clone().json()) as unknown;
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function requestWithJsonBody(
  request: Request,
  body: Record<string, unknown>
): Request {
  const headers = new Headers(request.headers);
  headers.set("content-type", "application/json");
  headers.delete("content-length");

  return new Request(request.url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    redirect: "manual"
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonError(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

function notFoundResponse(): Response {
  return jsonError(
    404,
    "AUTH_ROUTE_NOT_FOUND",
    "Authentication route not found."
  );
}
