import {
  parseLimitedJsonBody,
  requireJsonContentType,
  type PersonalizationRouteHandler
} from "../personalization";
import { parseDuplicateCheckInput } from "./input";
import type { AdminSongDuplicateService } from "./service";

export const DUPLICATE_CHECK_BODY_LIMIT_BYTES = 64 * 1024;

export function createAdminSongDuplicateCheckHandler(
  service: AdminSongDuplicateService
): PersonalizationRouteHandler {
  return async ({ request }) => {
    requireJsonContentType(request);
    const body = await parseLimitedJsonBody(
      request,
      DUPLICATE_CHECK_BODY_LIMIT_BYTES
    );
    return Response.json(await service.check(parseDuplicateCheckInput(body)));
  };
}
