import {
  PersonalizationApiError,
  personalizationError
} from "../personalization";

export type FavoriteCursor = Readonly<{
  id: string;
}>;

type EncodedFavoriteCursor = readonly [version: 1, id: string];

const MAX_ENCODED_CURSOR_LENGTH = 512;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function encodeFavoriteCursor(cursor: FavoriteCursor): string {
  const payload: EncodedFavoriteCursor = [1, cursor.id];

  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodeFavoriteCursor(value: string): FavoriteCursor {
  try {
    if (
      value.length === 0 ||
      value.length > MAX_ENCODED_CURSOR_LENGTH ||
      !BASE64URL_PATTERN.test(value)
    ) {
      throw personalizationError("INVALID_REQUEST");
    }

    const parsed: unknown = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8")
    );

    if (!isEncodedFavoriteCursor(parsed)) {
      throw personalizationError("INVALID_REQUEST");
    }

    return { id: parsed[1] };
  } catch (error) {
    if (
      error instanceof PersonalizationApiError &&
      error.code === "INVALID_REQUEST"
    ) {
      throw error;
    }

    throw personalizationError("INVALID_REQUEST");
  }
}

function isEncodedFavoriteCursor(
  value: unknown
): value is EncodedFavoriteCursor {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    value[0] === 1 &&
    typeof value[1] === "string" &&
    UUID_PATTERN.test(value[1])
  );
}
