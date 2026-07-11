import { getPrismaClient } from "../../../lib/db/prisma";
import { createProvidersGetHandlerForDb } from "../../../lib/providers/route-handler";

type ProvidersGetHandler = ReturnType<typeof createProvidersGetHandlerForDb>;

let providersGetHandler: ProvidersGetHandler | undefined;

export function GET(request: Request): Promise<Response> {
  providersGetHandler ??= createProvidersGetHandlerForDb(getPrismaClient());

  return providersGetHandler(request);
}
