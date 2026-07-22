import { GOOGLE_CALLBACK_PATH } from "./policy";

const EXAMPLE_AUTH_SECRET =
  "replace-with-a-random-secret-of-at-least-32-characters";

const REQUIRED_VARIABLES = [
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
  "AUTH_TRUSTED_ORIGIN",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_OAUTH_CALLBACK_URL"
] as const;

type AuthEnvironmentName = (typeof REQUIRED_VARIABLES)[number];

export type AuthEnvironment = {
  production: boolean;
  secret: string;
  baseOrigin: string;
  trustedOrigin: string;
  googleClientId: string;
  googleClientSecret: string;
  googleCallbackURL: string;
};

export class AuthEnvironmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthEnvironmentError";
  }
}

export function readAuthEnvironment(
  environment: NodeJS.ProcessEnv = process.env
): AuthEnvironment {
  const production = environment.NODE_ENV === "production";
  const values = Object.fromEntries(
    REQUIRED_VARIABLES.map((name) => [name, requiredValue(environment, name)])
  ) as Record<AuthEnvironmentName, string>;

  if (values.BETTER_AUTH_SECRET.length < 32) {
    throw new AuthEnvironmentError(
      "BETTER_AUTH_SECRET must contain at least 32 characters."
    );
  }

  if (production && values.BETTER_AUTH_SECRET === EXAMPLE_AUTH_SECRET) {
    throw new AuthEnvironmentError(
      "BETTER_AUTH_SECRET must replace the documented example value in production."
    );
  }

  const baseURL = parseAbsoluteURL("BETTER_AUTH_URL", values.BETTER_AUTH_URL);
  const trustedOrigin = parseAbsoluteURL(
    "AUTH_TRUSTED_ORIGIN",
    values.AUTH_TRUSTED_ORIGIN
  );
  const callbackURL = parseAbsoluteURL(
    "GOOGLE_OAUTH_CALLBACK_URL",
    values.GOOGLE_OAUTH_CALLBACK_URL
  );

  assertOriginOnly("BETTER_AUTH_URL", baseURL);
  assertOriginOnly("AUTH_TRUSTED_ORIGIN", trustedOrigin);
  assertNoWildcard(values.AUTH_TRUSTED_ORIGIN);
  assertAllowedProtocol("BETTER_AUTH_URL", baseURL, production);
  assertAllowedProtocol("AUTH_TRUSTED_ORIGIN", trustedOrigin, production);
  assertAllowedProtocol("GOOGLE_OAUTH_CALLBACK_URL", callbackURL, production);

  if (trustedOrigin.origin !== baseURL.origin) {
    throw new AuthEnvironmentError(
      "AUTH_TRUSTED_ORIGIN must exactly match BETTER_AUTH_URL."
    );
  }

  const expectedCallbackURL = new URL(GOOGLE_CALLBACK_PATH, baseURL.origin);
  if (callbackURL.href !== expectedCallbackURL.href) {
    throw new AuthEnvironmentError(
      `GOOGLE_OAUTH_CALLBACK_URL must exactly match BETTER_AUTH_URL${GOOGLE_CALLBACK_PATH}.`
    );
  }

  return {
    production,
    secret: values.BETTER_AUTH_SECRET,
    baseOrigin: baseURL.origin,
    trustedOrigin: trustedOrigin.origin,
    googleClientId: values.GOOGLE_CLIENT_ID,
    googleClientSecret: values.GOOGLE_CLIENT_SECRET,
    googleCallbackURL: callbackURL.href
  };
}

function requiredValue(
  environment: NodeJS.ProcessEnv,
  name: AuthEnvironmentName
): string {
  const value = environment[name]?.trim();
  if (value === undefined || value === "") {
    throw new AuthEnvironmentError(`${name} is required for authentication.`);
  }

  return value;
}

function parseAbsoluteURL(name: AuthEnvironmentName, value: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new AuthEnvironmentError(`${name} must be a valid absolute URL.`);
  }

  if (parsed.username !== "" || parsed.password !== "") {
    throw new AuthEnvironmentError(`${name} must not contain URL credentials.`);
  }

  return parsed;
}

function assertOriginOnly(name: AuthEnvironmentName, url: URL): void {
  if (url.pathname !== "/" || url.search !== "" || url.hash !== "") {
    throw new AuthEnvironmentError(`${name} must contain an origin only.`);
  }
}

function assertNoWildcard(value: string): void {
  if (value.includes("*")) {
    throw new AuthEnvironmentError(
      "AUTH_TRUSTED_ORIGIN must not contain wildcard patterns."
    );
  }
}

function assertAllowedProtocol(
  name: AuthEnvironmentName,
  url: URL,
  production: boolean
): void {
  if (url.protocol === "https:") {
    return;
  }

  if (
    !production &&
    url.protocol === "http:" &&
    (url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "[::1]")
  ) {
    return;
  }

  throw new AuthEnvironmentError(
    `${name} must use HTTPS${production ? " in production" : " or loopback HTTP"}.`
  );
}
