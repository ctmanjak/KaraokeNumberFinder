import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";
import type { PoolConfig } from "pg";

import {
  formatSearchSmokeResult,
  runSearchSmoke,
  type SearchSmokeDbClient
} from "../../lib/seed/search-smoke";
import { PrismaClient } from "../../lib/generated/prisma/client";

type ParsedArgs = {
  fixturePath: string;
};

const args = parseCliArgs(process.argv.slice(2));
const databaseUrl = process.env.DATABASE_URL;

if (databaseUrl === undefined || databaseUrl.trim() === "") {
  console.error("error: DATABASE_URL is required for seed search smoke.");
  console.error(
    "Set DATABASE_URL using the existing Prisma environment configuration, then rerun seed:search-smoke."
  );
  process.exit(1);
}

const adapter = new PrismaPg(createPgPoolConfig(databaseUrl));
const prisma = new PrismaClient({ adapter });

try {
  const result = await runSearchSmoke(
    toSearchSmokeDbClient(prisma),
    args.fixturePath
  );

  for (const line of formatSearchSmokeResult(result)) {
    if (line.startsWith("failure:")) {
      console.error(line);
    } else {
      console.log(line);
    }
  }

  if (result.failures.length > 0) {
    process.exitCode = 1;
  }
} catch (error) {
  console.error(
    `error: failed to run search smoke fixture ${args.fixturePath}`
  );
  console.error(`error: ${errorMessage(error)}`);
  console.error(
    "Check DATABASE_URL, ensure migrations and seed import are applied, and verify the smoke fixture format."
  );
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}

function parseArgs(args: string[]): ParsedArgs {
  let fixturePath = "seed/search-smoke.csv";

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--fixture") {
      const value = args[index + 1];

      if (value === undefined || value.startsWith("--")) {
        throw new Error("--fixture requires a path");
      }

      fixturePath = value;
      index += 1;
      continue;
    }

    throw new Error(`unexpected argument ${arg}`);
  }

  return { fixturePath };
}

function parseCliArgs(args: string[]): ParsedArgs {
  try {
    return parseArgs(args);
  } catch (error) {
    console.error(`error: ${errorMessage(error)}`);
    process.exit(1);
  }
}

function createPgPoolConfig(connectionString: string): PoolConfig {
  const rejectUnauthorized = process.env.DATABASE_SSL_REJECT_UNAUTHORIZED;

  if (rejectUnauthorized === undefined || rejectUnauthorized.trim() === "") {
    return { connectionString };
  }

  return {
    connectionString,
    ssl: { rejectUnauthorized: rejectUnauthorized !== "false" }
  };
}

function toSearchSmokeDbClient(prisma: PrismaClient): SearchSmokeDbClient {
  return {
    songAlias: {
      findMany: (args) => prisma.songAlias.findMany(args)
    }
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
