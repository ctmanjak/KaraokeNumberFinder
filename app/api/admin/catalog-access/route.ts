import { createServerAdminCatalogHandler } from "@/lib/admin-catalog/server";

export const GET = createServerAdminCatalogHandler("catalog_menu_api", () =>
  Response.json({ enabled: true })
);
