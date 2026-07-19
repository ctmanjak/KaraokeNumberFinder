import type { BetterAuthOptions } from "better-auth";

import type { AuthEnvironment } from "./env";
import {
  createVerifiedGoogleUserInfo,
  type VerifyGoogleToken
} from "./google-profile";
import {
  authCookiePolicy,
  OAUTH_STATE_TTL_SECONDS,
  SESSION_IDLE_TTL_SECONDS,
  SESSION_UPDATE_AGE_SECONDS
} from "./policy";
import { capNewSessionExpiry, capSessionRefresh } from "./session-policy";

type AuthDatabase = NonNullable<BetterAuthOptions["database"]>;

export type AuthOptionsDependencies = {
  database: AuthDatabase;
  verifyGoogleToken?: VerifyGoogleToken;
  now?: () => Date;
  writeSafeLog?: (level: "debug" | "info" | "warn" | "error") => void;
};

export function createAuthOptions(
  environment: AuthEnvironment,
  dependencies: AuthOptionsDependencies
): BetterAuthOptions {
  const cookie = authCookiePolicy(environment.production);
  const now = dependencies.now ?? (() => new Date());

  return {
    appName: "KaraokeNumberFinder",
    baseURL: environment.baseOrigin,
    basePath: "/api/auth",
    secret: environment.secret,
    database: dependencies.database,
    trustedOrigins: [environment.trustedOrigin],
    socialProviders: {
      google: {
        clientId: environment.googleClientId,
        clientSecret: environment.googleClientSecret,
        redirectURI: environment.googleCallbackURL,
        disableIdTokenSignIn: true,
        getUserInfo: createVerifiedGoogleUserInfo(
          environment.googleClientId,
          dependencies.verifyGoogleToken,
          now
        )
      }
    },
    emailAndPassword: { enabled: false },
    session: {
      expiresIn: SESSION_IDLE_TTL_SECONDS,
      updateAge: SESSION_UPDATE_AGE_SECONDS,
      disableSessionRefresh: false,
      cookieCache: { enabled: false }
    },
    account: {
      updateAccountOnSignIn: true,
      encryptOAuthTokens: true,
      skipStateCookieCheck: false,
      storeStateStrategy: "database",
      storeAccountCookie: false,
      accountLinking: {
        enabled: false,
        disableImplicitLinking: true,
        trustedProviders: [],
        allowDifferentEmails: false,
        allowUnlinkingAll: false,
        updateUserInfoOnLink: false
      }
    },
    verification: {
      disableCleanup: true,
      storeIdentifier: "plain"
    },
    advanced: {
      database: { generateId: "uuid" },
      trustedProxyHeaders: false,
      disableCSRFCheck: false,
      disableOriginCheck: false,
      useSecureCookies: false,
      cookiePrefix: cookie.prefix,
      defaultCookieAttributes: {
        secure: cookie.secure,
        httpOnly: true,
        sameSite: "lax",
        path: "/"
      },
      cookies: {
        state: {
          attributes: { maxAge: OAUTH_STATE_TTL_SECONDS }
        },
        session_token: {
          attributes: {
            secure: cookie.secure,
            httpOnly: true,
            sameSite: "lax",
            path: "/"
          }
        }
      }
    },
    databaseHooks: {
      user: {
        create: {
          async before(user) {
            return user.emailVerified === true;
          }
        }
      },
      account: {
        create: {
          async before(account) {
            if (account.providerId !== "google") {
              return false;
            }

            return { data: withoutPersistedOAuthTokens(account) };
          }
        },
        update: {
          async before(account) {
            return { data: withoutPersistedOAuthTokens(account) };
          }
        }
      },
      session: {
        create: {
          async before(session) {
            return { data: capNewSessionExpiry(session) };
          }
        },
        update: {
          async before(update, context) {
            const capped = capSessionRefresh(update, context);
            return capped === null ? false : { data: capped };
          }
        }
      }
    },
    logger: {
      level: "warn",
      disableColors: true,
      log(level) {
        const normalizedLevel = level === "debug" ? "debug" : level;
        if (dependencies.writeSafeLog !== undefined) {
          dependencies.writeSafeLog(normalizedLevel);
          return;
        }

        const message =
          "[auth] Authentication operation reported an internal event.";
        if (normalizedLevel === "error") {
          console.error(message);
        } else if (normalizedLevel === "warn") {
          console.warn(message);
        }
      }
    }
  };
}

function withoutPersistedOAuthTokens<T extends Record<string, unknown>>(
  account: T
): T {
  return {
    ...account,
    accessToken: null,
    refreshToken: null,
    idToken: null,
    accessTokenExpiresAt: null,
    refreshTokenExpiresAt: null,
    scope: null
  };
}
