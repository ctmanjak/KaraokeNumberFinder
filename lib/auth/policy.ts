export const AUTH_BASE_PATH = "/api/auth";
export const GOOGLE_CALLBACK_PATH = `${AUTH_BASE_PATH}/callback/google`;

export const OAUTH_STATE_TTL_SECONDS = 10 * 60;
export const SESSION_IDLE_TTL_SECONDS = 7 * 24 * 60 * 60;
export const SESSION_UPDATE_AGE_SECONDS = 24 * 60 * 60;
export const SESSION_ABSOLUTE_TTL_SECONDS = 30 * 24 * 60 * 60;

export const ALLOWED_AUTH_CALLBACK_PATHS = [
  "/",
  "/favorites",
  "/settings"
] as const;

export type AllowedAuthCallbackPath =
  (typeof ALLOWED_AUTH_CALLBACK_PATHS)[number];

export type AuthCookiePolicy = {
  prefix: string;
  sessionCookieName: string;
  stateCookieName: string;
  secure: boolean;
};

export function authCookiePolicy(production: boolean): AuthCookiePolicy {
  const prefix = production ? "__Host-knf" : "knf-dev";

  return {
    prefix,
    sessionCookieName: `${prefix}.session_token`,
    stateCookieName: `${prefix}.state`,
    secure: production
  };
}
