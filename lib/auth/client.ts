import {
  createRequestTimeout,
  readErrorEnvelope,
  readJson
} from "@/lib/http/client";
import type { AllowedAuthCallbackPath } from "@/lib/auth/policy";

export const AUTH_REQUEST_TIMEOUT_MS = 5_000;

export type BrowserAuthUser = Readonly<{
  id: string;
  name?: string;
  email?: string;
  image?: string;
}>;

export type BrowserAuthState =
  | Readonly<{ status: "authenticated"; user: BrowserAuthUser }>
  | Readonly<{ status: "guest" | "unavailable" }>;

export class AuthClientError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly status: number | undefined;

  constructor(options: {
    code: string;
    message: string;
    retryable: boolean;
    status?: number;
  }) {
    super(options.message);
    this.name = "AuthClientError";
    this.code = options.code;
    this.retryable = options.retryable;
    this.status = options.status;
  }
}

export async function fetchBrowserAuthState(
  fetcher: typeof fetch = fetch,
  requestTimeoutMs = AUTH_REQUEST_TIMEOUT_MS
): Promise<BrowserAuthState> {
  const request = createRequestTimeout(requestTimeoutMs);

  try {
    const response = await fetcher("/api/auth/get-session", {
      cache: "no-store",
      headers: { accept: "application/json" },
      signal: request.signal
    });

    if (response.status === 401) {
      return { status: "guest" };
    }

    if (!response.ok) {
      return { status: "unavailable" };
    }

    const payload = await readJson(response);
    if (payload === null) {
      return { status: "guest" };
    }

    const user = readSafeSessionUser(payload);
    return user === undefined
      ? { status: "unavailable" }
      : { status: "authenticated", user };
  } catch {
    return { status: "unavailable" };
  } finally {
    request.clear();
  }
}

export async function createGoogleSignInUrl(
  options: {
    callbackURL?: AllowedAuthCallbackPath;
    fetcher?: typeof fetch;
    requestTimeoutMs?: number;
  } = {}
): Promise<string> {
  const request = createRequestTimeout(
    options.requestTimeoutMs ?? AUTH_REQUEST_TIMEOUT_MS
  );

  try {
    let response: Response;
    try {
      response = await (options.fetcher ?? fetch)("/api/auth/sign-in/social", {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          provider: "google",
          callbackURL: options.callbackURL ?? "/"
        }),
        signal: request.signal
      });
    } catch {
      throw new AuthClientError({
        code: "AUTH_UNAVAILABLE",
        message: "로그인 요청을 시작하지 못했습니다.",
        retryable: true
      });
    }

    const payload = await readJson(response);
    if (!response.ok) {
      const error = readErrorEnvelope(payload);
      throw new AuthClientError({
        code: error.code ?? "AUTH_UNAVAILABLE",
        message: "로그인 요청을 시작하지 못했습니다.",
        retryable: response.status >= 500,
        status: response.status
      });
    }

    if (!isGoogleSignInPayload(payload)) {
      throw new AuthClientError({
        code: "INVALID_AUTH_RESPONSE",
        message: "로그인 응답을 확인하지 못했습니다.",
        retryable: true,
        status: response.status
      });
    }

    return payload.url;
  } finally {
    request.clear();
  }
}

export async function signOutBrowserSession(
  options: {
    fetcher?: typeof fetch;
    requestTimeoutMs?: number;
  } = {}
): Promise<void> {
  const request = createRequestTimeout(
    options.requestTimeoutMs ?? AUTH_REQUEST_TIMEOUT_MS
  );

  try {
    let response: Response;
    try {
      response = await (options.fetcher ?? fetch)("/api/auth/sign-out", {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json"
        },
        body: "{}",
        signal: request.signal
      });
    } catch {
      throw new AuthClientError({
        code: "AUTH_UNAVAILABLE",
        message: "로그아웃 요청을 완료하지 못했습니다.",
        retryable: true
      });
    }

    const payload = await readJson(response);
    if (!response.ok) {
      const error = readErrorEnvelope(payload);
      throw new AuthClientError({
        code: error.code ?? "AUTH_UNAVAILABLE",
        message: "로그아웃 요청을 완료하지 못했습니다.",
        retryable: response.status >= 500 || response.status === 429,
        status: response.status
      });
    }

    if (!isExactSuccessPayload(payload)) {
      throw new AuthClientError({
        code: "INVALID_AUTH_RESPONSE",
        message: "로그아웃 응답을 확인하지 못했습니다.",
        retryable: true,
        status: response.status
      });
    }
  } finally {
    request.clear();
  }
}

function readSafeSessionUser(value: unknown): BrowserAuthUser | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  const session = value as Record<string, unknown>;
  if (
    typeof session.user !== "object" ||
    session.user === null ||
    Array.isArray(session.user)
  ) {
    return undefined;
  }

  const user = session.user as Record<string, unknown>;
  const id = safeTrimmedString(user.id, 200);
  if (id === undefined) {
    return undefined;
  }

  const name = safeTrimmedString(user.name, 200);
  const email = safeEmail(user.email);
  const image = safeImageUrl(user.image);
  return {
    id,
    ...(name === undefined ? {} : { name }),
    ...(email === undefined ? {} : { email }),
    ...(image === undefined ? {} : { image })
  };
}

function isGoogleSignInPayload(
  value: unknown
): value is Readonly<{ url: string; redirect?: boolean }> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const payload = value as Record<string, unknown>;
  if (typeof payload.url !== "string" || payload.redirect !== true) {
    return false;
  }

  try {
    const url = new URL(payload.url);
    return (
      url.origin === "https://accounts.google.com" &&
      url.pathname === "/o/oauth2/v2/auth" &&
      url.username === "" &&
      url.password === ""
    );
  } catch {
    return false;
  }
}

function isExactSuccessPayload(
  value: unknown
): value is Readonly<{ success: true }> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === 1 &&
    (value as Record<string, unknown>).success === true
  );
}

function safeTrimmedString(
  value: unknown,
  maxLength: number
): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= maxLength
    ? trimmed
    : undefined;
}

function safeEmail(value: unknown): string | undefined {
  const email = safeTrimmedString(value, 320);
  return email !== undefined && /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)
    ? email
    : undefined;
}

function safeImageUrl(value: unknown): string | undefined {
  const image = safeTrimmedString(value, 2_048);
  if (image === undefined) {
    return undefined;
  }

  try {
    const url = new URL(image);
    return url.protocol === "https:" &&
      url.username === "" &&
      url.password === ""
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}
