const M3_TEST_DATABASE_NAME = "karaoke_number_finder_m3_test";
const LOCAL_DATABASE_HOSTS = new Set([
  "127.0.0.1",
  "localhost",
  "[::1]",
  "::1"
]);

export function optionalM3TestDatabaseUrl(
  value: string | undefined
): string | undefined {
  if (value === undefined || value.trim() === "") {
    return undefined;
  }

  return requireM3TestDatabaseUrl(value);
}

export function requireM3TestDatabaseUrl(value: string | undefined): string {
  if (value === undefined || value.trim() === "") {
    throw new Error(
      "M3_TEST_DATABASE_URL is required and must target the dedicated local M3 test database."
    );
  }

  const parsed = new URL(value);
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));

  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    !LOCAL_DATABASE_HOSTS.has(parsed.hostname) ||
    databaseName !== M3_TEST_DATABASE_NAME
  ) {
    throw new Error(
      `M3_TEST_DATABASE_URL must target PostgreSQL on localhost database ${M3_TEST_DATABASE_NAME}.`
    );
  }

  return value;
}
