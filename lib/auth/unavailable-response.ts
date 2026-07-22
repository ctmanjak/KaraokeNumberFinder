import {
  AUTH_BASE_PATH,
  authCookiePolicy,
  GOOGLE_CALLBACK_PATH
} from "./policy";

export function createUnavailableAuthResponse(
  request: Request,
  production: boolean
): Response {
  const pathname = new URL(request.url).pathname;
  const cookie = authCookiePolicy(production);

  if (pathname === GOOGLE_CALLBACK_PATH) {
    return new Response(null, {
      status: 303,
      headers: {
        location: "/?auth_error=OAUTH_FAILED",
        "cache-control": "no-store",
        "set-cookie": expiredCookie(cookie.stateCookieName, cookie.secure)
      }
    });
  }

  if (pathname === `${AUTH_BASE_PATH}/sign-out`) {
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "set-cookie": expiredCookie(cookie.sessionCookieName, cookie.secure)
      }
    });
  }

  return new Response(
    JSON.stringify({
      error: {
        code: "AUTH_UNAVAILABLE",
        message: "Authentication is unavailable."
      }
    }),
    {
      status: 503,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store"
      }
    }
  );
}

function expiredCookie(name: string, secure: boolean): string {
  return `${name}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}
