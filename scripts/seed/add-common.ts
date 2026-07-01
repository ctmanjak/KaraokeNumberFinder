import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import {
  formatSeedAddValidation,
  type SeedAddResult
} from "../../lib/seed/add";

export type ParsedArgs = {
  seedDir: string;
  values: Map<string, string>;
};

export async function runSeedAddCli(
  args: string[],
  run: (args: ParsedArgs) => Promise<SeedAddResult> | SeedAddResult
): Promise<void> {
  try {
    const result = await run(parseArgs(args));
    console.log(
      `Added ${result.file} row ${result.rowNumber} with id ${result.id}.`
    );

    for (const line of formatSeedAddValidation(result)) {
      if (line.startsWith("error:")) {
        console.error(line);
      } else {
        console.warn(line);
      }
    }

    const errorCount = result.validation?.errors.length ?? 0;
    const warningCount = result.validation?.warnings.length ?? 0;

    if (errorCount > 0) {
      console.error(
        `Seed validation failed after add with ${errorCount} error(s) and ${warningCount} warning(s). Fix the reported seed row(s) and rerun npm run seed:validate.`
      );
      process.exitCode = 1;
      return;
    }

    console.log(`Seed validation passed with ${warningCount} warning(s).`);
  } catch (error) {
    console.error(`error: ${errorMessage(error)}`);
    process.exitCode = 1;
  }
}

export function parseArgs(args: string[]): ParsedArgs {
  const values = new Map<string, string>();
  let seedDir = "seed";

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (!arg.startsWith("--")) {
      throw new Error(`unexpected argument ${arg}`);
    }

    const key = arg.slice(2);
    const value = args[index + 1];

    if (value === undefined || value.startsWith("--")) {
      throw new Error(`--${key} requires a value`);
    }

    index += 1;

    if (key === "seed-dir") {
      seedDir = value;
    } else {
      values.set(key, value);
    }
  }

  return { seedDir, values };
}

export async function collectFields(
  args: ParsedArgs,
  fields: readonly { key: string; prompt: string; required?: boolean }[]
): Promise<Record<string, string>> {
  const missingRequired = fields.some(
    (field) => field.required === true && !hasValue(args.values.get(field.key))
  );
  const rl = missingRequired
    ? readline.createInterface({ input, output })
    : undefined;
  const collected: Record<string, string> = {};

  try {
    for (const field of fields) {
      const existing = args.values.get(field.key);

      if (hasValue(existing) || field.required !== true) {
        collected[field.key] = existing ?? "";
        continue;
      }

      collected[field.key] = (await rl?.question(`${field.prompt}: `)) ?? "";
    }
  } finally {
    rl?.close();
  }

  return collected;
}

function hasValue(value: string | undefined): boolean {
  return value !== undefined && value.trim() !== "";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
