import { describe, expect, it } from "vitest";

import { PersonalizationApiError } from "../personalization";
import { decodeFavoriteCursor, encodeFavoriteCursor } from "./cursor";

describe("favorite cursor", () => {
  it("round-trips an opaque record pointer without exposing its raw value", () => {
    const cursor = {
      id: "46c50e34-f227-4bc8-a6d1-b56ac44b60f6"
    };

    const encoded = encodeFavoriteCursor(cursor);

    expect(encoded).not.toContain(cursor.id);
    expect(decodeFavoriteCursor(encoded)).toEqual(cursor);
  });

  it.each(["not-base64", "e30", "WzIsImJhZCIsImlkIl0"])(
    "rejects an invalid opaque cursor",
    (cursor) => {
      expect(() => decodeFavoriteCursor(cursor)).toThrowError(
        expect.objectContaining<Partial<PersonalizationApiError>>({
          code: "INVALID_REQUEST"
        })
      );
    }
  );
});
