import { describe, expect, it, vi } from "vitest";

import { resolveAdminCatalogMode } from "./config";

describe("admin catalog configuration", () => {
  it.each([
    ["off", "off"],
    ["on", "on"]
  ] as const)("accepts the explicit %s mode", (configured, expected) => {
    expect(
      resolveAdminCatalogMode({
        NODE_ENV: "production",
        ADMIN_CATALOG_MODE: configured
      })
    ).toBe(expected);
  });

  it.each([undefined, "canary", "ON", "unexpected-secret-value"])(
    "fails closed in production for %s without logging the value",
    (configured) => {
      const writeConfigurationError = vi.fn();
      const environment: NodeJS.ProcessEnv = {
        NODE_ENV: "production",
        ...(configured === undefined ? {} : { ADMIN_CATALOG_MODE: configured })
      };

      expect(
        resolveAdminCatalogMode(environment, {
          now: () => new Date("2026-07-26T00:00:00.000Z"),
          writeConfigurationError
        })
      ).toBe("off");
      expect(writeConfigurationError).toHaveBeenCalledWith({
        event: "admin_catalog.configuration_error",
        occurred_at: "2026-07-26T00:00:00.000Z",
        issue: configured === undefined ? "missing" : "invalid"
      });
      expect(JSON.stringify(writeConfigurationError.mock.calls)).not.toContain(
        configured ?? "ADMIN_CATALOG_MODE"
      );
    }
  );

  it("does not silently enable a missing local or test mode", () => {
    expect(resolveAdminCatalogMode({ NODE_ENV: "development" })).toBe("off");
    expect(resolveAdminCatalogMode({ NODE_ENV: "test" })).toBe("off");
  });
});
