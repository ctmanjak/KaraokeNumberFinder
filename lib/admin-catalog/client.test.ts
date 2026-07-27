import { describe, expect, it, vi } from "vitest";

import { fetchAdminCatalogAccess } from "./client";

describe("administrator catalog access client", () => {
  it("returns true only for the exact enabled response", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({ enabled: true }, { status: 200 })
    );

    await expect(fetchAdminCatalogAccess(fetcher)).resolves.toBe(true);
    expect(fetcher).toHaveBeenCalledWith(
      "/api/admin/catalog-access",
      expect.objectContaining({ cache: "no-store" })
    );
  });

  it.each([
    [403, { error: { code: "ADMIN_CATALOG_NOT_ENABLED" } }],
    [500, { error: { code: "PERSONALIZATION_UNAVAILABLE" } }],
    [200, { enabled: false }],
    [200, { enabled: true, extra: "unexpected" }]
  ])(
    "fails closed for status %s and a non-enabled contract",
    async (status, body) => {
      const fetcher = vi.fn(async () => Response.json(body, { status }));

      await expect(fetchAdminCatalogAccess(fetcher)).resolves.toBe(false);
    }
  );
});
