import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";

import {
  syntheticDatasetValidationPassed,
  validateSyntheticDataset,
  type SyntheticDatasetValidationDbClient
} from "../../lib/perf/synthetic-dataset-validate";
import { assertSyntheticValidationDbAllowed } from "../../lib/perf/synthetic-import-guard";
import { PrismaClient } from "../../lib/generated/prisma/client";
import { createSeedPgPoolConfig } from "../seed/db-config";

type ParsedArgs = {
  seedDir: string;
  datasetLabel: string;
  filesOnly: boolean;
  dbLabel?: string;
};

const args = parseCliArgs(process.argv.slice(2));
let prisma: PrismaClient | null = null;

try {
  if (!args.filesOnly) {
    assertSyntheticValidationDbAllowed({
      dbLabel: args.dbLabel,
      databaseUrl: process.env.DATABASE_URL
    });
    const adapter = new PrismaPg(createPgPoolConfig());
    prisma = new PrismaClient({ adapter });
  }

  const report = await validateSyntheticDataset({
    seedDir: args.seedDir,
    datasetLabel: args.datasetLabel,
    filesOnly: args.filesOnly,
    dbLabel: args.dbLabel,
    databaseUrl: process.env.DATABASE_URL,
    db: prisma === null ? undefined : toValidationDbClient(prisma)
  });

  console.log(JSON.stringify(report, null, 2));

  if (!syntheticDatasetValidationPassed(report)) {
    process.exitCode = 1;
  }
} catch (error) {
  console.error(`error: failed to validate synthetic dataset ${args.seedDir}`);
  console.error(`error: ${errorMessage(error)}`);
  process.exitCode = 1;
} finally {
  await prisma?.$disconnect();
}

function parseArgs(args: string[]): ParsedArgs {
  let seedDir: string | undefined;
  let datasetLabel: string | undefined;
  let dbLabel: string | undefined;
  let filesOnly = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--files-only" || arg === "--no-db") {
      filesOnly = true;
      continue;
    }

    if (arg === "--seed-dir") {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error("--seed-dir requires a path");
      }

      seedDir = value;
      index += 1;
      continue;
    }

    if (arg === "--dataset-label") {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error("--dataset-label requires a value");
      }

      datasetLabel = value;
      index += 1;
      continue;
    }

    if (arg === "--db-label") {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error("--db-label requires a value");
      }

      dbLabel = value;
      index += 1;
      continue;
    }

    throw new Error(`unexpected argument ${arg}`);
  }

  if (seedDir === undefined) {
    throw new Error("--seed-dir is required");
  }
  if (datasetLabel === undefined) {
    throw new Error("--dataset-label is required");
  }

  return { seedDir, datasetLabel, filesOnly, dbLabel };
}

function parseCliArgs(args: string[]): ParsedArgs {
  try {
    return parseArgs(args);
  } catch (error) {
    console.error(`error: ${errorMessage(error)}`);
    process.exit(1);
  }
}

function createPgPoolConfig() {
  try {
    return createSeedPgPoolConfig("perf:dataset-validate");
  } catch (error) {
    console.error(`error: ${errorMessage(error)}`);
    process.exit(1);
  }
}

function toValidationDbClient(
  prisma: PrismaClient
): SyntheticDatasetValidationDbClient {
  return {
    song: {
      count: (args) => prisma.song.count(args)
    },
    songAlias: {
      count: (args) => prisma.songAlias.count(args)
    },
    karaokeEntry: {
      count: (args) => prisma.karaokeEntry.count(args)
    },
    karaokeProvider: {
      count: (args) => prisma.karaokeProvider.count(args)
    }
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
