import {
  createRequestTimeout,
  readErrorEnvelope,
  readJson
} from "@/lib/http/client";

export const AUTH_REQUEST_TIMEOUT_MS = 5_000;

export type BrowserAuthState =
  | Readonly<{ status: "authenticated" }>
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

    return isAuthenticatedSession(payload)
      ? { status: "authenticated" }
      : { status: "unavailable" };
  } catch {
    return { status: "unavailable" };
  } finally {
    request.clear();
  }
}

export async function createGoogleSignInUrl(
  options: {
    callbackURL?: "/favorites";
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
          callbackURL: options.callbackURL ?? "/favorites"
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

function isAuthenticatedSession(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const session = value as Record<string, unknown>;
  if (
    typeof session.user !== "object" ||
    session.user === null ||
    Array.isArray(session.user)
  ) {
    return false;
  }

  const user = session.user as Record<string, unknown>;
  return typeof user.id === "string" && user.id.trim().length > 0;
}

function isGoogleSignInPayload(
  value: unknown
): value is Readonly<{ url: string; redirect?: boolean }> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const payload = value as Record<string, unknown>;
  if (
    typeof payload.url !== "string" ||
    (payload.redirect !== undefined && payload.redirect !== true)
  ) {
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
