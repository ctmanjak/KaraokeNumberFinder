import { getPrismaClient } from "../../../lib/db/prisma";
import { createSearchGetHandlerForDb } from "../../../lib/search/route-handler";

export const GET = createSearchGetHandlerForDb(getPrismaClient());
