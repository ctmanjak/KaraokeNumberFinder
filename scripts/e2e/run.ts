import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";

import { requireM3TestDatabaseUrl } from "../m3/test-db-url";

const testDatabaseURL = requireM3TestDatabaseUrl(
  process.env.M3_TEST_DATABASE_URL
);
const baseURL = process.env.KNF_E2E_BASE_URL ?? "https://127.0.0.1:3443";
const environment: NodeJS.ProcessEnv = {
  ...process.env,
  NODE_ENV: "production",
  NEXT_TELEMETRY_DISABLED: "1",
  DATABASE_URL: testDatabaseURL,
  M3_TEST_DATABASE_URL: testDatabaseURL,
  KNF_RUNTIME_ENV: "e2e",
  KNF_E2E_AUTH_ENABLED: "1",
  BETTER_AUTH_SECRET: randomBytes(48).toString("base64url"),
  BETTER_AUTH_URL: baseURL,
  AUTH_TRUSTED_ORIGIN: baseURL,
  GOOGLE_CLIENT_ID: "knf-browser-e2e-client",
  GOOGLE_CLIENT_SECRET: randomBytes(32).toString("base64url"),
  GOOGLE_OAUTH_CALLBACK_URL: `${baseURL}/api/auth/callback/google`
};

runLocalBinary("prisma", ["generate"], environment);
runLocalBinary("prisma", ["migrate", "deploy"], environment);
runNpmScript("seed:import", environment);
runLocalBinary("vite-node", ["scripts/e2e/cleanup.ts"], environment);

let exitCode = 1;
try {
  runLocalBinary("vite-node", ["scripts/e2e/setup.ts"], environment);
  runNpmScript("build", environment);
  exitCode = runLocalBinary(
    "playwright",
    ["test", ...process.argv.slice(2)],
    environment,
    false
  );
} finally {
  try {
    runLocalBinary("vite-node", ["scripts/e2e/cleanup.ts"], environment);
  } catch (cleanupError) {
    console.error("Post-test E2E cleanup failed:", cleanupError);
    if (exitCode === 0) {
      exitCode = 1;
    }
  }
}

process.exitCode = exitCode;

function runNpmScript(
  script: string,
  childEnvironment: NodeJS.ProcessEnv
): void {
  const command = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSync(command, ["run", script], {
    env: childEnvironment,
    stdio: "inherit"
  });
  assertSucceeded(result.status, `npm run ${script}`, result.error);
}

function runLocalBinary(
  binaryName: string,
  args: string[],
  childEnvironment: NodeJS.ProcessEnv,
  throwOnFailure = true
): number {
  const executable = path.join(
    process.cwd(),
    "node_modules",
    ".bin",
    process.platform === "win32" ? `${binaryName}.cmd` : binaryName
  );
  const result = spawnSync(executable, args, {
    env: childEnvironment,
    stdio: "inherit"
  });

  if (throwOnFailure) {
    assertSucceeded(
      result.status,
      `${binaryName} ${args.join(" ")}`,
      result.error
    );
  } else if (result.error !== undefined) {
    throw result.error;
  }
  return result.status ?? 1;
}

function assertSucceeded(
  status: number | null,
  command: string,
  error: Error | undefined
): void {
  if (error !== undefined) {
    throw error;
  }
  if (status !== 0) {
    throw new Error(`${command} failed with exit code ${status ?? "unknown"}.`);
  }
}
