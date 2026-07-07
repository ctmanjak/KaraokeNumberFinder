import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  isSyntheticDatasetLabel,
  SYNTHETIC_METADATA_FILE,
  type SyntheticDatasetLabel
} from "./synthetic-dataset";

export type SyntheticImportDbLabel = "local" | "sandbox";
export type SyntheticSafeDbLabel = SyntheticImportDbLabel;

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

export type SyntheticValidationGuardOptions = {
  dbLabel?: string;
  databaseUrl?: string;
};

export type SyntheticValidationGuardResult = {
  targetLabel: SyntheticSafeDbLabel;
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

  if (metadata === null) {
    return {
      synthetic: false,
      datasetLabel: null,
      targetLabel: normalizeDbLabel(options.dbLabel),
      message: "Seed directory does not contain synthetic dataset metadata."
    };
  }

  if (!isSyntheticDatasetLabel(metadata.dataset_label)) {
    throw new Error(
      `${SYNTHETIC_METADATA_FILE} has unsupported dataset_label ${metadata.dataset_label}`
    );
  }

  const targetLabel = assertSyntheticSafeDbTarget({
    dbLabel: options.dbLabel,
    databaseUrl: options.databaseUrl,
    requireExplicitDbLabel: options.allowSyntheticImportToLocal !== true,
    missingLabelMessage:
      "Synthetic import requires --db-label local, --db-label sandbox, or --allow-synthetic-import-to-local.",
    blockedLabelMessage: (label) =>
      `Synthetic import is blocked for db label ${label}. Use local or sandbox only.`,
    unsupportedLabelMessage: (label) =>
      `Synthetic import requires db label local or sandbox; received ${label}.`,
    productionLikeUrlMessage:
      "Synthetic import is blocked because DATABASE_URL looks like Neon, live, production, or production-like infrastructure."
  });

  return {
    synthetic: true,
    datasetLabel: metadata.dataset_label,
    targetLabel: targetLabel === "sandbox" ? "sandbox" : "local",
    message: `Synthetic dataset ${metadata.dataset_label} allowed for ${targetLabel ?? "local"} import target.`
  };
}

export function assertSyntheticValidationDbAllowed(
  options: SyntheticValidationGuardOptions
): SyntheticValidationGuardResult {
  const targetLabel = assertSyntheticSafeDbTarget({
    dbLabel: options.dbLabel,
    databaseUrl: options.databaseUrl,
    requireExplicitDbLabel: true,
    missingLabelMessage:
      "Synthetic dataset DB validation requires --db-label local or --db-label sandbox.",
    blockedLabelMessage: (label) =>
      `Synthetic dataset DB validation is blocked for db label ${label}. Use local or sandbox only.`,
    unsupportedLabelMessage: (label) =>
      `Synthetic dataset DB validation requires db label local or sandbox; received ${label}.`,
    productionLikeUrlMessage:
      "Synthetic dataset DB validation is blocked because DATABASE_URL looks like Neon, live, production, or production-like infrastructure."
  });

  return {
    targetLabel: targetLabel ?? "local",
    message: `Synthetic dataset DB validation allowed for ${targetLabel} target.`
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
  const hasProductionLikeToken = haystack
    .split(/[^a-z0-9]+|_/u)
    .some((token) => ["neon", "prod", "production", "live"].includes(token));

  if (hasProductionLikeToken) {
    return true;
  }

  return false;
}

function normalizeDbLabel(label: string | undefined): string | null {
  const normalized = label?.trim().toLowerCase();
  return normalized === undefined || normalized === "" ? null : normalized;
}

function assertSyntheticSafeDbTarget(options: {
  dbLabel?: string;
  databaseUrl?: string;
  requireExplicitDbLabel: boolean;
  missingLabelMessage: string;
  blockedLabelMessage(label: string): string;
  unsupportedLabelMessage(label: string): string;
  productionLikeUrlMessage: string;
}): SyntheticSafeDbLabel | null {
  const targetLabel = normalizeDbLabel(options.dbLabel);

  if (targetLabel === null) {
    if (options.requireExplicitDbLabel) {
      throw new Error(options.missingLabelMessage);
    }
  } else if (BLOCKED_DB_LABELS.has(targetLabel)) {
    throw new Error(options.blockedLabelMessage(targetLabel));
  } else if (!ALLOWED_DB_LABELS.has(targetLabel)) {
    throw new Error(options.unsupportedLabelMessage(targetLabel));
  }

  if (looksProductionLikeDatabaseUrl(options.databaseUrl)) {
    throw new Error(options.productionLikeUrlMessage);
  }

  if (targetLabel === null) {
    return null;
  }

  return targetLabel === "sandbox" ? "sandbox" : "local";
}
