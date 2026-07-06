import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  isSyntheticDatasetLabel,
  SYNTHETIC_METADATA_FILE,
  type SyntheticDatasetLabel
} from "./synthetic-dataset";

export type SyntheticImportDbLabel = "local" | "sandbox";

export type SyntheticImportGuardOptions = {
  seedDir: string;
  dbLabel?: string;
  databaseUrl?: string;
  allowSyntheticImportToLocal?: boolean;
};

export type SyntheticImportGuardResult =
  | {
      synthetic: false;
      datasetLabel: null;
      targetLabel: string | null;
      message: string;
    }
  | {
      synthetic: true;
      datasetLabel: SyntheticDatasetLabel;
      targetLabel: SyntheticImportDbLabel;
      message: string;
    };

const ALLOWED_DB_LABELS = new Set(["local", "sandbox"]);
const BLOCKED_DB_LABELS = new Set([
  "neon",
  "production",
  "prod",
  "live",
  "staging-live",
  "remote"
]);

export function assertSyntheticImportAllowed(
  options: SyntheticImportGuardOptions
): SyntheticImportGuardResult {
  const metadata = readSyntheticDatasetMetadata(options.seedDir);
  const targetLabel = normalizeDbLabel(options.dbLabel);

  if (metadata === null) {
    return {
      synthetic: false,
      datasetLabel: null,
      targetLabel,
      message: "Seed directory does not contain synthetic dataset metadata."
    };
  }

  if (!isSyntheticDatasetLabel(metadata.dataset_label)) {
    throw new Error(
      `${SYNTHETIC_METADATA_FILE} has unsupported dataset_label ${metadata.dataset_label}`
    );
  }

  if (targetLabel === null && options.allowSyntheticImportToLocal !== true) {
    throw new Error(
      "Synthetic import requires --db-label local, --db-label sandbox, or --allow-synthetic-import-to-local."
    );
  }

  if (targetLabel !== null && BLOCKED_DB_LABELS.has(targetLabel)) {
    throw new Error(
      `Synthetic import is blocked for db label ${targetLabel}. Use local or sandbox only.`
    );
  }

  if (targetLabel !== null && !ALLOWED_DB_LABELS.has(targetLabel)) {
    throw new Error(
      `Synthetic import requires db label local or sandbox; received ${targetLabel}.`
    );
  }

  if (looksProductionLikeDatabaseUrl(options.databaseUrl)) {
    throw new Error(
      "Synthetic import is blocked because DATABASE_URL looks like Neon, live, production, or production-like infrastructure."
    );
  }

  return {
    synthetic: true,
    datasetLabel: metadata.dataset_label,
    targetLabel: targetLabel === "sandbox" ? "sandbox" : "local",
    message: `Synthetic dataset ${metadata.dataset_label} allowed for ${targetLabel ?? "local"} import target.`
  };
}

export function readSyntheticDatasetMetadata(
  seedDir: string
): { dataset_label: string } | null {
  const metadataPath = path.join(seedDir, SYNTHETIC_METADATA_FILE);

  if (!existsSync(metadataPath)) {
    return null;
  }

  const parsed: unknown = JSON.parse(readFileSync(metadataPath, "utf8"));

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("dataset_label" in parsed) ||
    typeof parsed.dataset_label !== "string"
  ) {
    throw new Error(`${SYNTHETIC_METADATA_FILE} must include dataset_label`);
  }

  return { dataset_label: parsed.dataset_label };
}

export function looksProductionLikeDatabaseUrl(
  databaseUrl: string | undefined
): boolean {
  if (databaseUrl === undefined || databaseUrl.trim() === "") {
    return false;
  }

  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    return true;
  }

  const haystack = [
    parsed.hostname,
    parsed.pathname,
    parsed.username,
    parsed.search
  ]
    .join(" ")
    .toLowerCase();

  if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") {
    return false;
  }

  return haystack
    .split(/[^a-z0-9]+|_/u)
    .some((token) => ["neon", "prod", "production", "live"].includes(token));
}

function normalizeDbLabel(label: string | undefined): string | null {
  const normalized = label?.trim().toLowerCase();
  return normalized === undefined || normalized === "" ? null : normalized;
}
