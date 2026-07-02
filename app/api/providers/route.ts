import { getPrismaClient } from "../../../lib/db/prisma";
import { listProviders } from "../../../lib/providers/providers";
import { createProvidersGetHandler } from "../../../lib/providers/route-handler";

export const GET = createProvidersGetHandler((query) =>
  listProviders(getPrismaClient(), query)
);
