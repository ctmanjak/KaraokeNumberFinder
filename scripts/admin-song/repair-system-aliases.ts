import { Client } from "pg";

import {
  repairMissingSystemAliases,
  requireSystemAliasRepairApplyAuthorization,
  safeRepairDatabaseTarget
} from "../../lib/song-identity/system-alias-repair";

const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl === undefined || databaseUrl.trim() === "") {
  throw new Error("DATABASE_URL is required.");
}
const apply = process.argv.includes("--apply");
const expectedCreateCount = readExpectedCreateCount(process.argv);
const target = safeRepairDatabaseTarget(databaseUrl);
requireSystemAliasRepairApplyAuthorization({
  apply,
  confirmation: process.env.ADMIN_SONG_SYSTEM_ALIAS_REPAIR_CONFIRMED,
  expectedTargetFingerprint:
    process.env.ADMIN_SONG_SYSTEM_ALIAS_REPAIR_TARGET_SHA256,
  actualTargetFingerprint: target.fingerprint,
  expectedCreateCount
});

const client = new Client({ connectionString: databaseUrl });
await client.connect();
try {
  const result = await repairMissingSystemAliases(client, {
    apply,
    expectedCreateCount
  });
  console.log(
    JSON.stringify(
      {
        mode: apply ? "apply" : "dry-run",
        target,
        ...result
      },
      null,
      2
    )
  );
} finally {
  await client.end();
}

function readExpectedCreateCount(args: readonly string[]): number | undefined {
  const prefix = "--expected-create-count=";
  const value = args.find((argument) => argument.startsWith(prefix));
  if (value === undefined) return undefined;
  const count = Number(value.slice(prefix.length));
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error("Expected create count must be a non-negative integer.");
  }
  return count;
}
