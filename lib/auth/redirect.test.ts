import { describe, expect, it } from "vitest";

import { parseSafeAuthCallbackPath } from "./redirect";

describe("parseSafeAuthCallbackPath", () => {
  it.each(["/", "/favorites", "/settings"])("allows %s", (path) => {
    expect(parseSafeAuthCallbackPath(path)).toBe(path);
  });

  it.each([
    "https://evil.example/",
    "//evil.example/",
    "/\\evil.example",
    "/%2f%2fevil.example",
    "/favorites?next=https://evil.example",
    "/favorites#fragment",
    "/favorites/../settings",
    "/unknown"
  ])("rejects unsafe callback %s", (path) => {
    expect(parseSafeAuthCallbackPath(path)).toBeNull();
  });
});
