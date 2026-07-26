import "server-only";

import { readAuthEnvironment } from "../auth/env";
import { getPrismaClient } from "../db/prisma";
import { personalizationError } from "../personalization";
import { requireSession } from "../personalization/server";
import { isAdminCatalogEnabled } from "./config";
import {
  createAdminCatalogHandler,
  resolveAdminCatalogPageAccess,
  type AdminCatalogActorRole,
  type AdminCatalogRouteCategory
} from "./guard";

async function readActorRole(userId: string): Promise<AdminCatalogActorRole> {
  const actor = await getPrismaClient().user.findUnique({
    where: { id: userId },
    select: { role: true }
  });
  return actor?.role ?? null;
}

const serverGuardDependencies = {
  requireSession,
  readActorRole,
  isCatalogEnabled: isAdminCatalogEnabled
};

export function createServerAdminCatalogHandler(
  routeCategory: AdminCatalogRouteCategory,
  handler: Parameters<typeof createAdminCatalogHandler>[1]
) {
  return createAdminCatalogHandler(routeCategory, handler, {
    ...serverGuardDependencies,
    trustedOrigin() {
      try {
        return readAuthEnvironment().trustedOrigin;
      } catch {
        throw personalizationError("PERSONALIZATION_UNAVAILABLE");
      }
    }
  });
}

export function getServerAdminCatalogPageAccess(
  headers: Headers,
  routeCategory: AdminCatalogRouteCategory
) {
  return resolveAdminCatalogPageAccess(
    new Request("http://admin-catalog.internal/", { headers }),
    routeCategory,
    serverGuardDependencies
  );
}
