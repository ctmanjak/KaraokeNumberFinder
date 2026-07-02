import { getPrismaClient } from "../../../lib/db/prisma";
import { createProvidersGetHandlerForDb } from "../../../lib/providers/route-handler";

export const GET = createProvidersGetHandlerForDb(getPrismaClient());
