import {
  DEFAULT_SYNTHETIC_OUTPUT_ROOT,
  generateSyntheticDataset,
  syntheticDatasetConfigFor,
  type SyntheticDatasetLabel
} from "../../lib/perf/synthetic-dataset";

type ParsedArgs = {
  datasetLabel: SyntheticDatasetLabel;
  outputRoot: string;
};

const args = parseCliArgs(process.argv.slice(2));
const result = generateSyntheticDataset({
  datasetLabel: args.datasetLabel,
  outputRoot: args.outputRoot
});

console.log(`Generated ${result.metadata.dataset_label}`);
console.log(`Output directory: ${result.outputDir}`);
console.log(
  `Rows: songs=${result.metadata.row_counts.songs} aliases=${result.metadata.row_counts.song_aliases} entries=${result.metadata.row_counts.karaoke_entries} providers=${result.metadata.row_counts.karaoke_providers}`
);
console.log(`Fixture: ${result.metadata.fixture_path}`);
console.log(`Metadata: dataset-metadata.json`);

function parseArgs(args: string[]): ParsedArgs {
  let datasetLabel: string | undefined;
  let outputRoot = DEFAULT_SYNTHETIC_OUTPUT_ROOT;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--dataset-label") {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error("--dataset-label requires a value");
      }

      datasetLabel = value;
      index += 1;
      continue;
    }

    if (arg === "--output-root") {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error("--output-root requires a path");
      }

      outputRoot = value;
      index += 1;
      continue;
    }

    throw new Error(`unexpected argument ${arg}`);
  }

  if (datasetLabel === undefined) {
    throw new Error("--dataset-label is required");
  }

  return {
    datasetLabel: syntheticDatasetConfigFor(datasetLabel).label,
    outputRoot
  };
}

function parseCliArgs(args: string[]): ParsedArgs {
  try {
    return parseArgs(args);
  } catch (error) {
    console.error(`error: ${errorMessage(error)}`);
    process.exit(1);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
