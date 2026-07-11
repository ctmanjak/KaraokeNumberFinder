import { getPrismaClient } from "../../../lib/db/prisma";
import { createSearchGetHandlerForDb } from "../../../lib/search/route-handler";

type SearchGetHandler = ReturnType<typeof createSearchGetHandlerForDb>;

let searchGetHandler: SearchGetHandler | undefined;

export function GET(request: Request): Promise<Response> {
  searchGetHandler ??= createSearchGetHandlerForDb(getPrismaClient());

  return searchGetHandler(request);
}
