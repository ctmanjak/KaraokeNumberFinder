import { describe, expect, it } from "vitest";

import {
  optionalM3TestDatabaseUrl,
  requireM3TestDatabaseUrl
} from "./test-db-url";

const LOCAL_TEST_URL =
  "postgresql://prisma:prisma@127.0.0.1:55439/karaoke_number_finder_m3_test";

describe("M3 test database URL guard", () => {
  it("accepts only the dedicated local PostgreSQL database", () => {
    expect(requireM3TestDatabaseUrl(LOCAL_TEST_URL)).toBe(LOCAL_TEST_URL);
    expect(
      requireM3TestDatabaseUrl(
        "postgres://prisma:prisma@localhost:5432/karaoke_number_finder_m3_test"
      )
    ).toContain("karaoke_number_finder_m3_test");
  });

  it("allows the integration suite to skip when no URL is configured", () => {
    expect(optionalM3TestDatabaseUrl(undefined)).toBeUndefined();
    expect(optionalM3TestDatabaseUrl("  ")).toBeUndefined();
  });

  it.each([
    undefined,
    "postgresql://prisma:prisma@example.com:5432/karaoke_number_finder_m3_test",
    "postgresql://prisma:prisma@127.0.0.1:5432/another_database",
    "mysql://prisma:prisma@127.0.0.1:3306/karaoke_number_finder_m3_test"
  ])("rejects missing or unsafe database URL %s", (databaseUrl) => {
    expect(() => requireM3TestDatabaseUrl(databaseUrl)).toThrow(
      /M3_TEST_DATABASE_URL/
    );
  });
});
