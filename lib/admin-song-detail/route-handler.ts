import {
  parseLimitedJsonBody,
  personalizationError,
  requireJsonContentType,
  type PersonalizationRouteHandler
} from "../personalization";
import { parseAdminSongId } from "../admin-song-duplicate/input";
import { parseAdminSongPatchInput } from "./input";
import type { AdminSongDetailService } from "./service";
import { ADMIN_SONG_PATCH_BODY_LIMIT_BYTES } from "./types";

export function createAdminSongDetailGetHandler(
  service: AdminSongDetailService,
  songIdValue: unknown
): PersonalizationRouteHandler {
  return async ({ request, auth }) => {
    if (new URL(request.url).search !== "") {
      throw personalizationError("INVALID_REQUEST");
    }
    const songId = parseAdminSongId(songIdValue);
    return Response.json(await service.get(auth.user.id, songId));
  };
}

export function createAdminSongDetailPatchHandler(
  service: AdminSongDetailService,
  songIdValue: unknown
): PersonalizationRouteHandler {
  return async ({ request, auth }) => {
    if (new URL(request.url).search !== "") {
      throw personalizationError("INVALID_REQUEST");
    }
    const songId = parseAdminSongId(songIdValue);
    requireJsonContentType(request);
    const body = await parseLimitedJsonBody(
      request,
      ADMIN_SONG_PATCH_BODY_LIMIT_BYTES
    );
    return Response.json(
      await service.update(auth.user.id, songId, parseAdminSongPatchInput(body))
    );
  };
}
