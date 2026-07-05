import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";

import {
  formatSeedImportResult,
  importSeedDirectory,
  type SeedImportDbClient
} from "../../lib/seed/import";
import { PrismaClient } from "../../lib/generated/prisma/client";
import { createSeedPgPoolConfig } from "./db-config";

type ParsedArgs = {
  seedDir: string;
  dryRun: boolean;
};

type SeedPrismaClient = Pick<
  PrismaClient,
  "karaokeProvider" | "song" | "songAlias" | "karaokeEntry"
>;

const args = parseCliArgs(process.argv.slice(2));
const adapter = new PrismaPg(createPgPoolConfig());
const prisma = new PrismaClient({ adapter });

try {
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
      `Seed validation failed with ${result.errors.length} error(s) and ${result.warnings.length} warning(s). Fix the reported seed row(s), then rerun seed:import.`
    );
    process.exitCode = 1;
  }
} catch (error) {
  console.error(
    `error: failed to ${args.dryRun ? "dry-run" : "import"} seed directory ${args.seedDir}`
  );
  console.error(`error: ${errorMessage(error)}`);
  console.error(
    "Check DATABASE_URL, ensure migrations are applied, and rerun seed:validate before importing."
  );
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}

function parseArgs(args: string[]): ParsedArgs {
  let seedDir = "seed";
  let dryRun = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--dry-run") {
      dryRun = true;
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

    throw new Error(`unexpected argument ${arg}`);
  }

  return { seedDir, dryRun };
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
    return createSeedPgPoolConfig("seed:import");
  } catch (error) {
    console.error(`error: ${errorMessage(error)}`);
    process.exit(1);
  }
}

function toSeedImportDbClient(prisma: PrismaClient): SeedImportDbClient {
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
    },
    $transaction: (run) =>
      prisma.$transaction((tx) => run(toSeedImportTransactionClient(tx)), {
        timeout: 30_000
      })
  };
}

function toSeedImportTransactionClient(
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
