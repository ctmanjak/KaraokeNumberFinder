const LOCAL_DATABASE_HOSTS = new Set([
  "127.0.0.1",
  "localhost",
  "[::1]",
  "::1"
]);
const LOCAL_APP_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);
const M3_TEST_DATABASE_NAME = "karaoke_number_finder_m3_test";

export function isBrowserE2EEnabled(
  environment: NodeJS.ProcessEnv = process.env
): boolean {
  if (
    environment.KNF_RUNTIME_ENV !== "e2e" ||
    environment.KNF_E2E_AUTH_ENABLED !== "1" ||
    environment.NODE_ENV !== "production"
  ) {
    return false;
  }

  const databaseURL = environment.DATABASE_URL;
  const testDatabaseURL = environment.M3_TEST_DATABASE_URL;
  const authURL = environment.BETTER_AUTH_URL;
  if (
    databaseURL === undefined ||
    testDatabaseURL === undefined ||
    databaseURL !== testDatabaseURL ||
    authURL === undefined
  ) {
    return false;
  }

  return isDedicatedTestDatabase(databaseURL) && isLoopbackHttpsOrigin(authURL);
}

export function isBrowserE2ERequest(
  request: Request,
  environment: NodeJS.ProcessEnv = process.env
): boolean {
  if (!isBrowserE2EEnabled(environment)) {
    return false;
  }

  const expectedOrigin = environment.BETTER_AUTH_URL;
  const forwardedProtocol = request.headers.get("x-forwarded-proto");
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedOrigin =
    forwardedProtocol !== null && forwardedHost !== null
      ? `${forwardedProtocol}://${forwardedHost}`
      : null;
  const requestOrigin = new URL(request.url).origin;
  const fetchSite = request.headers.get("sec-fetch-site");

  return (
    expectedOrigin !== undefined &&
    (requestOrigin === expectedOrigin || forwardedOrigin === expectedOrigin) &&
    request.headers.get("origin") === expectedOrigin &&
    (fetchSite === null || fetchSite === "same-origin") &&
    request.headers.get("x-knf-e2e-test") === "1"
  );
}

function isDedicatedTestDatabase(value: string): boolean {
  try {
    const parsed = new URL(value);
    const databaseName = decodeURIComponent(
      parsed.pathname.replace(/^\//u, "")
    );
    return (
      ["postgres:", "postgresql:"].includes(parsed.protocol) &&
      LOCAL_DATABASE_HOSTS.has(parsed.hostname) &&
      databaseName === M3_TEST_DATABASE_NAME
    );
  } catch {
    return false;
  }
}

function isLoopbackHttpsOrigin(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (
      parsed.protocol === "https:" &&
      LOCAL_APP_HOSTS.has(parsed.hostname) &&
      parsed.origin === value
    );
  } catch {
    return false;
  }
}
