import "dotenv/config";

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";

import { Pool } from "pg";

import {
  runPerfExplain,
  type PerfExplainDbClient
} from "../../lib/perf/explain";
import { createSeedPgPoolConfig } from "../seed/db-config";

type ParsedArgs = {
  dbLabel: string;
  datasetLabel: string;
  fixturePath: string;
  caseLimit: number | null;
  outputPath: string | null;
};

const PERF_EXPLAIN_STATEMENT_TIMEOUT_MS = 30_000;
const PERF_EXPLAIN_QUERY_TIMEOUT_MS = 35_000;

const args = parseCliArgs(process.argv.slice(2));
const pool = new Pool(createPgPoolConfig());

try {
  const report = await runPerfExplain(toPerfExplainDbClient(pool), {
    dbLabel: args.dbLabel,
    datasetLabel: args.datasetLabel,
    fixturePath: args.fixturePath,
    caseLimit: args.caseLimit,
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
  console.error("error: failed to run perf EXPLAIN ANALYZE");
  console.error(`error: ${errorMessage(error)}`);
  console.error(
    "Check DATABASE_URL, migrations, seed import state, and CLI options. The script only runs read-only SELECT/EXPLAIN ANALYZE statements."
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}

function parseArgs(args: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    dbLabel: "local",
    datasetLabel: "current-seed",
    fixturePath: "seed/search-smoke.csv",
    caseLimit: null,
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
    "--case-limit": (value, option) => {
      parsed.caseLimit = parsePositiveInteger(value, option);
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
  npm run perf:explain -- [options]

Options:
  --db-label <label>          Label recorded in output, e.g. local or neon
  --dataset-label <label>     Dataset label, defaults to current-seed
  --fixture <path>            Search smoke CSV path, defaults to seed/search-smoke.csv
  --case-limit <n>            Limit representative search cases, useful for Neon
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
  if (!/^\d+$/u.test(value)) {
    throw new Error(`${option} must be an integer`);
  }

  const parsed = Number.parseInt(value, 10);

  if (parsed < 1) {
    throw new Error(`${option} must be greater than zero`);
  }

  return parsed;
}

function createPgPoolConfig() {
  try {
    return {
      ...createSeedPgPoolConfig("perf:explain"),
      statement_timeout: PERF_EXPLAIN_STATEMENT_TIMEOUT_MS,
      query_timeout: PERF_EXPLAIN_QUERY_TIMEOUT_MS
    };
  } catch (error) {
    console.error(`error: ${errorMessage(error)}`);
    process.exit(1);
  }
}

function toPerfExplainDbClient(pool: Pool): PerfExplainDbClient {
  return {
    query: (sql, values) => pool.query(sql, values)
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
