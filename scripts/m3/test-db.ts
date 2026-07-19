import { spawnSync } from "node:child_process";
import path from "node:path";

import { requireM3TestDatabaseUrl } from "./test-db-url";

const testDatabaseUrl = requireM3TestDatabaseUrl(
  process.env.M3_TEST_DATABASE_URL
);

runLocalBinary("prisma", ["migrate", "deploy"], {
  DATABASE_URL: testDatabaseUrl
});
runLocalBinary("prisma", ["generate"], {
  DATABASE_URL: testDatabaseUrl
});
runLocalBinary("vitest", ["run", "prisma/auth-user-data-schema.test.ts"], {
  M3_TEST_DATABASE_URL: testDatabaseUrl
});
runLocalBinary(
  "vitest",
  ["run", "lib/search-history/repository.integration.test.ts"],
  {
    M3_TEST_DATABASE_URL: testDatabaseUrl
  }
);

function runLocalBinary(
  binaryName: string,
  args: string[],
  environment: Record<string, string>
): void {
  const executable = path.join(
    process.cwd(),
    "node_modules",
    ".bin",
    process.platform === "win32" ? `${binaryName}.cmd` : binaryName
  );
  const result = spawnSync(executable, args, {
    env: { ...process.env, ...environment },
    stdio: "inherit"
  });

  if (result.error !== undefined) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(
      `${binaryName} ${args.join(" ")} failed with exit code ${result.status ?? "unknown"}.`
    );
  }
}
