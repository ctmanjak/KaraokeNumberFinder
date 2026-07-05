import "dotenv/config";

import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

import { PrismaPg } from "@prisma/adapter-pg";

import {
  runPerfBaseline,
  type PerfBaselineDbClient
} from "../../lib/perf/baseline";
import { PrismaClient } from "../../lib/generated/prisma/client";
import { createSeedPgPoolConfig } from "../seed/db-config";

type ParsedArgs = {
  dbLabel: string;
  datasetLabel: string;
  fixturePath: string;
  iterations: number;
  warmup: number;
  outputPath: string | null;
};

const args = parseCliArgs(process.argv.slice(2));
const adapter = new PrismaPg(createPgPoolConfig());
const prisma = new PrismaClient({ adapter });

try {
  const report = await runPerfBaseline(toPerfBaselineDbClient(prisma), {
    dbLabel: args.dbLabel,
    datasetLabel: args.datasetLabel,
    fixturePath: args.fixturePath,
    iterations: args.iterations,
    warmup: args.warmup,
    commit: gitValue(["rev-parse", "HEAD"]),
    branch: gitValue(["branch", "--show-current"]),
    runStartedAt: new Date().toISOString()
  });
  const json = `${JSON.stringify(report, null, 2)}\n`;

  if (args.outputPath !== null) {
    writeFileSync(args.outputPath, json, "utf8");
  }

  process.stdout.write(json);
} catch (error) {
  console.error("error: failed to run perf baseline harness");
  console.error(`error: ${errorMessage(error)}`);
  console.error(
    "Check DATABASE_URL, migrations, seed import state, and CLI options. The harness does not import or mutate seed data."
  );
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}

function parseArgs(args: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    dbLabel: "local",
    datasetLabel: "current-seed",
    fixturePath: "seed/search-smoke.csv",
    iterations: 10,
    warmup: 3,
    outputPath: null
  };
  const optionHandlers: Record<
    string,
    (value: string, option: string) => void
  > = {
    "--db-label": (value) => {
      parsed.dbLabel = value;
    },
    "--dataset-label": (value) => {
      parsed.datasetLabel = value;
    },
    "--fixture": (value) => {
      parsed.fixturePath = value;
    },
    "--iterations": (value, option) => {
      parsed.iterations = parsePositiveInteger(value, option);
    },
    "--warmup": (value, option) => {
      parsed.warmup = parseNonNegativeInteger(value, option);
    },
    "--output": (value) => {
      parsed.outputPath = path.resolve(value);
    }
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--help") {
      printHelpAndExit();
    }

    const handler = optionHandlers[arg];

    if (handler !== undefined) {
      handler(readOptionValue(args, index, arg), arg);
      index += 1;
      continue;
    }

    throw new Error(`unexpected argument ${arg}`);
  }

  return parsed;
}

function parseCliArgs(args: string[]): ParsedArgs {
  try {
    return parseArgs(args);
  } catch (error) {
    console.error(`error: ${errorMessage(error)}`);
    printHelpAndExit(1);
  }
}

function printHelpAndExit(exitCode = 0): never {
  console.log(`Usage:
  npm run perf:baseline -- [options]

Options:
  --db-label <label>          Label recorded in output, e.g. local or neon
  --dataset-label <label>     Dataset label, defaults to current-seed
  --fixture <path>            Search smoke CSV path, defaults to seed/search-smoke.csv
  --iterations <n>            Measured iterations per scenario, defaults to 10
  --warmup <n>                Warm-up iterations per scenario, defaults to 3
  --output <path>             Also write the JSON report to this path
  --help                      Show this help
`);
  process.exit(exitCode);
}

function readOptionValue(
  args: string[],
  index: number,
  option: string
): string {
  const value = args[index + 1];

  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${option} requires a value`);
  }

  return value;
}

function parsePositiveInteger(value: string, option: string): number {
  const parsed = parseNonNegativeInteger(value, option);

  if (parsed < 1) {
    throw new Error(`${option} must be greater than zero`);
  }

  return parsed;
}

function parseNonNegativeInteger(value: string, option: string): number {
  if (!/^\d+$/u.test(value)) {
    throw new Error(`${option} must be an integer`);
  }

  return Number.parseInt(value, 10);
}

function createPgPoolConfig() {
  try {
    return createSeedPgPoolConfig("perf:baseline");
  } catch (error) {
    console.error(`error: ${errorMessage(error)}`);
    process.exit(1);
  }
}

function toPerfBaselineDbClient(prisma: PrismaClient): PerfBaselineDbClient {
  return {
    karaokeProvider: {
      findMany: (args) => prisma.karaokeProvider.findMany(args as never)
    },
    songAlias: {
      findMany: (args) => prisma.songAlias.findMany(args as never),
      count: () => prisma.songAlias.count()
    },
    song: {
      count: () => prisma.song.count()
    },
    karaokeEntry: {
      count: () => prisma.karaokeEntry.count()
    }
  };
}

function gitValue(args: string[]): string | null {
  try {
    return execFileSync("git", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return null;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
