import { getPrismaClient } from "../../lib/db/prisma";
import { E2E_FIXTURE_MARKER } from "../../lib/e2e/constants";
import { isBrowserE2EEnabled } from "../../lib/e2e/guard";

if (!isBrowserE2EEnabled()) {
  throw new Error(
    "Browser E2E cleanup is disabled outside the guarded runtime."
  );
}

const prisma = getPrismaClient();
await prisma.$transaction(async (transaction) => {
  await transaction.user.deleteMany({
    where: { email: { endsWith: "@e2e.invalid" } }
  });
  await transaction.session.deleteMany();
  await transaction.verification.deleteMany();
  await transaction.karaokeEntry.deleteMany({
    where: { verifiedBy: E2E_FIXTURE_MARKER }
  });
  await transaction.karaokeProvider.deleteMany({
    where: {
      verifiedBy: E2E_FIXTURE_MARKER,
      sourceName: E2E_FIXTURE_MARKER
    }
  });
});
await prisma.$disconnect();
