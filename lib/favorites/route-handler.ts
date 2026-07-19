import {
  ownedWhere,
  personalizationError,
  requireValidInput,
  type PersonalizationRouteHandler
} from "../personalization";
import {
  DEFAULT_FAVORITE_LIMIT,
  MAX_FAVORITE_LIMIT,
  type FavoriteListQuery,
  type FavoriteService
} from "./service";

const SONG_ID_MAX_LENGTH = 128;
const FAVORITES_PATH_PREFIX = "/api/favorites/";
const LIST_QUERY_KEYS = new Set(["cursor", "limit"]);

export function createFavoritesGetHandler(
  service: FavoriteService
): PersonalizationRouteHandler {
  return async ({ request, auth }) => {
    const query = parseFavoriteListQuery(new URL(request.url).searchParams);
    const response = await service.list(ownedWhere(auth, {}), query);
    return Response.json(response);
  };
}

export function createFavoritePutHandler(
  service: FavoriteService
): PersonalizationRouteHandler {
  return async ({ request, auth }) => {
    const songId = parseFavoriteSongId(request);
    const response = await service.add(ownedWhere(auth, { songId }));
    return Response.json(response);
  };
}

export function createFavoriteDeleteHandler(
  service: FavoriteService
): PersonalizationRouteHandler {
  return async ({ request, auth }) => {
    const songId = parseFavoriteSongId(request);
    const response = await service.delete(ownedWhere(auth, { songId }));
    return Response.json(response);
  };
}

export function parseFavoriteListQuery(
  searchParams: URLSearchParams
): FavoriteListQuery {
  for (const key of searchParams.keys()) {
    if (!LIST_QUERY_KEYS.has(key) || searchParams.getAll(key).length !== 1) {
      throw personalizationError("INVALID_REQUEST");
    }
  }

  const cursorValue = searchParams.get("cursor");
  const limitValue = searchParams.get("limit");
  const limit =
    limitValue === null || limitValue === ""
      ? DEFAULT_FAVORITE_LIMIT
      : Number(limitValue);

  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_FAVORITE_LIMIT) {
    throw personalizationError("INVALID_REQUEST");
  }

  return {
    limit,
    ...(cursorValue === null || cursorValue === ""
      ? {}
      : { cursor: cursorValue })
  };
}

export function parseFavoriteSongId(request: Request): string {
  const pathname = new URL(request.url).pathname;

  if (!pathname.startsWith(FAVORITES_PATH_PREFIX)) {
    throw personalizationError("INVALID_REQUEST");
  }

  const encodedSongId = pathname.slice(FAVORITES_PATH_PREFIX.length);
  let songId: string;
  try {
    songId = decodeURIComponent(encodedSongId);
  } catch {
    throw personalizationError("INVALID_REQUEST");
  }

  return requireValidInput(songId, isSongId);
}

function isSongId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= SONG_ID_MAX_LENGTH &&
    !value.includes("/") &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}
