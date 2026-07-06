import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";

import {
  assertSyntheticImportAllowed,
  type SyntheticImportGuardResult
} from "../../lib/perf/synthetic-import-guard";
import {
  formatSeedImportResult,
  importSeedDirectory,
  type SeedImportDbClient
} from "../../lib/seed/import";
import { PrismaClient } from "../../lib/generated/prisma/client";
import { createSeedPgPoolConfig } from "../seed/db-config";

type ParsedArgs = {
  seedDir: string;
  dryRun: boolean;
  dbLabel?: string;
  allowSyntheticImportToLocal: boolean;
};

type SeedPrismaClient = Pick<
  PrismaClient,
  "karaokeProvider" | "song" | "songAlias" | "karaokeEntry"
>;

const args = parseCliArgs(process.argv.slice(2));
let prisma: PrismaClient | null = null;

try {
  const guard = assertGuard(args);
  const adapter = new PrismaPg(createPgPoolConfig());
  prisma = new PrismaClient({ adapter });

  console.log(guard.message);
  console.log(
    `Synthetic import target: db_label=${guard.targetLabel} mode=${args.dryRun ? "dry-run" : "import"} seed_dir=${args.seedDir}`
  );

  const result = await importSeedDirectory(toSeedImportDbClient(prisma), {
    seedDir: args.seedDir,
    dryRun: args.dryRun
  });

  for (const line of formatSeedImportResult(result)) {
    if (line.startsWith("error:")) {
      console.error(line);
    } else if (line.startsWith("warning:")) {
      console.warn(line);
    } else {
      console.log(line);
    }
  }

  if (result.errors.length > 0) {
    console.error(
      `Synthetic seed validation failed with ${result.errors.length} error(s) and ${result.warnings.length} warning(s).`
    );
    process.exitCode = 1;
  }
} catch (error) {
  console.error(
    `error: failed to ${args.dryRun ? "dry-run" : "import"} synthetic dataset ${args.seedDir}`
  );
  console.error(`error: ${errorMessage(error)}`);
  process.exitCode = 1;
} finally {
  await prisma?.$disconnect();
}

function parseArgs(args: string[]): ParsedArgs {
  let seedDir: string | undefined;
  let dryRun = false;
  let dbLabel: string | undefined;
  let allowSyntheticImportToLocal = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }

    if (arg === "--allow-synthetic-import-to-local") {
      allowSyntheticImportToLocal = true;
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

  return { seedDir, dryRun, dbLabel, allowSyntheticImportToLocal };
}

function parseCliArgs(args: string[]): ParsedArgs {
  try {
    return parseArgs(args);
  } catch (error) {
    console.error(`error: ${errorMessage(error)}`);
    process.exit(1);
  }
}

function assertGuard(
  args: ParsedArgs
): Extract<SyntheticImportGuardResult, { synthetic: true }> {
  const guard = assertSyntheticImportAllowed({
    seedDir: args.seedDir,
    dbLabel: args.dbLabel,
    databaseUrl: process.env.DATABASE_URL,
    allowSyntheticImportToLocal: args.allowSyntheticImportToLocal
  });

  if (!guard.synthetic) {
    throw new Error(
      "perf:dataset-import requires a generated synthetic dataset directory with dataset-metadata.json."
    );
  }

  return guard;
}

function createPgPoolConfig() {
  try {
    return createSeedPgPoolConfig("perf:dataset-import");
  } catch (error) {
    console.error(`error: ${errorMessage(error)}`);
    process.exit(1);
  }
}

function toSeedImportDbClient(prisma: PrismaClient): SeedImportDbClient {
  return {
    ...seedImportDelegates(prisma),
    $transaction: (run) =>
      prisma.$transaction((tx) => run(toSeedImportTransactionClient(tx)), {
        timeout: 30_000
      })
  };
}

function toSeedImportTransactionClient(
  prisma: SeedPrismaClient
): Omit<SeedImportDbClient, "$transaction"> {
  return seedImportDelegates(prisma);
}

function seedImportDelegates(
  prisma: SeedPrismaClient
): Omit<SeedImportDbClient, "$transaction"> {
  return {
    karaokeProvider: {
      findMany: (args) => prisma.karaokeProvider.findMany(args),
      upsert: (args) => prisma.karaokeProvider.upsert(args)
    },
    song: {
      findMany: (args) => prisma.song.findMany(args),
      upsert: (args) => prisma.song.upsert(args)
    },
    songAlias: {
      findMany: (args) => prisma.songAlias.findMany(args),
      upsert: (args) =>
        prisma.songAlias.upsert({
          ...args,
          create: args.create as Parameters<
            typeof prisma.songAlias.upsert
          >[0]["create"],
          update: args.update as Parameters<
            typeof prisma.songAlias.upsert
          >[0]["update"]
        })
    },
    karaokeEntry: {
      findMany: (args) => prisma.karaokeEntry.findMany(args),
      upsert: (args) =>
        prisma.karaokeEntry.upsert({
          ...args,
          create: args.create as Parameters<
            typeof prisma.karaokeEntry.upsert
          >[0]["create"],
          update: args.update as Parameters<
            typeof prisma.karaokeEntry.upsert
          >[0]["update"]
        })
    }
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
