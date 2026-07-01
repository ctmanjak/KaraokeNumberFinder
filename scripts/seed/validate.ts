import {
  formatSeedValidationIssue,
  validateSeedDirectory
} from "../../lib/seed/validate";

const seedDir = parseSeedDir(process.argv.slice(2));
const result = validateSeedDirectory(seedDir);

for (const warning of result.warnings) {
  console.warn(`warning: ${formatSeedValidationIssue(warning)}`);
}

for (const error of result.errors) {
  console.error(`error: ${formatSeedValidationIssue(error)}`);
}

if (result.errors.length > 0) {
  console.error(
    `Seed validation failed with ${result.errors.length} error(s) and ${result.warnings.length} warning(s).`
  );
  process.exitCode = 1;
} else {
  console.log(
    `Seed validation passed with ${result.warnings.length} warning(s).`
  );
}

function parseSeedDir(args: string[]): string {
  const seedDirFlagIndex = args.indexOf("--seed-dir");

  if (seedDirFlagIndex === -1) {
    return "seed";
  }

  const value = args[seedDirFlagIndex + 1];

  if (value === undefined || value.trim() === "") {
    console.error("--seed-dir requires a path");
    process.exit(1);
  }

  return value;
}
