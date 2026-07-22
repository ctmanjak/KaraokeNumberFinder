import { randomUUID } from "node:crypto";

import { getPrismaClient } from "../../lib/db/prisma";
import { E2E_FIXTURE_MARKER } from "../../lib/e2e/constants";
import { isBrowserE2EEnabled } from "../../lib/e2e/guard";

if (!isBrowserE2EEnabled()) {
  throw new Error("Browser E2E setup is disabled outside the guarded runtime.");
}

const prisma = getPrismaClient();
const sourceProvider = await prisma.karaokeProvider.findFirst({
  where: { isActive: true, karaokeEntries: { some: {} } },
  orderBy: [{ isDefault: "desc" }, { displayOrder: "asc" }, { id: "asc" }],
  include: { karaokeEntries: { orderBy: { id: "asc" } } }
});

if (sourceProvider === null) {
  throw new Error(
    "Browser E2E requires one active provider with catalog data."
  );
}

const runId = randomUUID();
const fixtureProviderId = `e2e-provider-${runId}`;
await prisma.karaokeProvider.create({
  data: {
    id: fixtureProviderId,
    name: `E2E 제공사 ${runId.slice(0, 8)}`,
    country: "KR",
    isActive: true,
    displayOrder: sourceProvider.displayOrder + 1,
    isDefault: false,
    sourceName: E2E_FIXTURE_MARKER,
    verifiedBy: E2E_FIXTURE_MARKER,
    verificationNote: "Ephemeral browser E2E provider; removed after the run.",
    karaokeEntries: {
      create: sourceProvider.karaokeEntries.map((entry, index) => ({
        id: `e2e-entry-${runId}-${index}`,
        songId: entry.songId,
        karaokeNumber: entry.karaokeNumber,
        versionInfo: entry.versionInfo,
        availabilityStatus: entry.availabilityStatus,
        lastVerifiedAt: entry.lastVerifiedAt,
        sourceName: E2E_FIXTURE_MARKER,
        verifiedBy: E2E_FIXTURE_MARKER,
        verificationNote: "Ephemeral browser E2E catalog copy."
      }))
    }
  }
});

await prisma.$disconnect();
