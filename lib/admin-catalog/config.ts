export type AdminCatalogMode = "off" | "on";

export type AdminCatalogConfigurationErrorEvent = Readonly<{
  event: "admin_catalog.configuration_error";
  occurred_at: string;
  issue: "missing" | "invalid";
}>;

export type WriteAdminCatalogConfigurationError = (
  event: AdminCatalogConfigurationErrorEvent
) => void;

export function resolveAdminCatalogMode(
  environment: NodeJS.ProcessEnv,
  options: {
    now?: () => Date;
    writeConfigurationError?: WriteAdminCatalogConfigurationError;
  } = {}
): AdminCatalogMode {
  const configured = environment.ADMIN_CATALOG_MODE;
  if (configured === "off" || configured === "on") {
    return configured;
  }

  if (environment.NODE_ENV === "production") {
    writeConfigurationError(
      {
        event: "admin_catalog.configuration_error",
        occurred_at: (options.now ?? (() => new Date()))().toISOString(),
        issue: configured === undefined ? "missing" : "invalid"
      },
      options.writeConfigurationError
    );
  }

  return "off";
}

export function isAdminCatalogEnabled(
  environment: NodeJS.ProcessEnv = process.env
): boolean {
  return (
    resolveAdminCatalogMode(environment, {
      writeConfigurationError: defaultConfigurationErrorWriter
    }) === "on"
  );
}

function writeConfigurationError(
  event: AdminCatalogConfigurationErrorEvent,
  writer: WriteAdminCatalogConfigurationError | undefined
): void {
  try {
    (writer ?? defaultConfigurationErrorWriter)(event);
  } catch {
    console.error(
      "[admin-catalog] Failed to write catalog configuration error event."
    );
  }
}

function defaultConfigurationErrorWriter(
  event: AdminCatalogConfigurationErrorEvent
): void {
  console.error("[admin-catalog] Catalog configuration is invalid.", event);
}
