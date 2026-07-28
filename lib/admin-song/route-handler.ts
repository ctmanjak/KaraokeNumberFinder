import {
  parseLimitedJsonBody,
  personalizationError,
  requireJsonContentType,
  type PersonalizationRouteHandler
} from "../personalization";
import { parseAdminSongInput } from "./input";
import {
  InvalidAdminSongListQueryError,
  parseAdminSongListQuery,
  parseAdminSongListResponse
} from "./list-contract";
import type { AdminSongService } from "./service";
import { ADMIN_SONG_POST_BODY_LIMIT_BYTES } from "./types";

export function createAdminSongOptionsHandler(
  service: AdminSongService
): PersonalizationRouteHandler {
  return async ({ request, auth }) => {
    if (new URL(request.url).search !== "") {
      throw personalizationError("INVALID_REQUEST");
    }
    return Response.json(await service.getOptions(auth.user.id));
  };
}

export function createAdminSongListHandler(
  service: AdminSongService
): PersonalizationRouteHandler {
  return async ({ request, auth }) => {
    let query;
    try {
      query = parseAdminSongListQuery(new URL(request.url).searchParams);
    } catch (error) {
      if (error instanceof InvalidAdminSongListQueryError) {
        throw personalizationError("VALIDATION_ERROR");
      }
      throw error;
    }
    return Response.json(
      parseAdminSongListResponse(await service.list(auth.user.id, query))
    );
  };
}

export function createAdminSongPostHandler(
  service: AdminSongService
): PersonalizationRouteHandler {
  return async ({ request, auth }) => {
    if (new URL(request.url).search !== "") {
      throw personalizationError("INVALID_REQUEST");
    }
    requireJsonContentType(request);
    const input = parseAdminSongInput(
      await parseLimitedJsonBody(request, ADMIN_SONG_POST_BODY_LIMIT_BYTES)
    );
    return Response.json(await service.create(auth.user.id, input), {
      status: 201
    });
  };
}
