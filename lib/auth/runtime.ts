import { betterAuth, type BetterAuthOptions } from "better-auth";
import { toNextJsHandler } from "better-auth/next-js";

import type { AuthEnvironment } from "./env";
import type { VerifyGoogleToken } from "./google-profile";
import type { OAuthFlowStore } from "./oauth-flow-store";
import { createAuthOptions } from "./options";
import { authCookiePolicy } from "./policy";
import {
  createAuthRouteHandlers,
  type AuthFrameworkHandlers
} from "./route-handler";

type AuthDatabase = NonNullable<BetterAuthOptions["database"]>;

export type CreateAuthRuntimeOptions = {
  environment: AuthEnvironment;
  database: AuthDatabase;
  flowStore: OAuthFlowStore;
  verifyGoogleToken?: VerifyGoogleToken;
  now?: () => Date;
  generateNonce?: () => string;
  revokeSessionToken?: (token: string) => Promise<void>;
  writeSafeLog?: (level: "debug" | "info" | "warn" | "error") => void;
};

export function createAuthRuntime(options: CreateAuthRuntimeOptions) {
  const authOptions = createAuthOptions(options.environment, {
    database: options.database,
    verifyGoogleToken: options.verifyGoogleToken,
    now: options.now,
    writeSafeLog: options.writeSafeLog
  });
  const auth = betterAuth(authOptions);
  const framework = toNextJsHandler(auth) as AuthFrameworkHandlers;
  const handlers = createAuthRouteHandlers({
    framework,
    flowStore: options.flowStore,
    baseOrigin: options.environment.baseOrigin,
    googleClientId: options.environment.googleClientId,
    googleCallbackURL: options.environment.googleCallbackURL,
    cookie: authCookiePolicy(options.environment.production),
    now: options.now,
    generateNonce: options.generateNonce,
    readExistingSessionToken: async (request) => {
      const session = await auth.api.getSession({
        headers: request.headers,
        query: {
          disableCookieCache: true,
          disableRefresh: true
        }
      });

      return session?.session.token ?? null;
    },
    revokeSessionToken: options.revokeSessionToken,
    writeSafeLog: (event) => {
      options.writeSafeLog?.(event === "callback" ? "warn" : "error");
    }
  });

  return { auth, authOptions, handlers };
}

export type AuthRuntime = ReturnType<typeof createAuthRuntime>;
