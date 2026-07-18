import { describe, expect, it } from "vitest";

import { validateMutationRequest } from "./csrf";
import { PersonalizationApiError } from "./errors";

const TRUSTED_ORIGIN = "https://knf.example";

describe("validateMutationRequest", () => {
  it("accepts exact same-origin JSON mutations, including UTF-8 charset", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(() =>
        validateMutationRequest(mutationRequest(method), TRUSTED_ORIGIN)
      ).not.toThrow();
    }

    expect(() =>
      validateMutationRequest(
        mutationRequest("POST", {
          "content-type": 'Application/JSON; Charset="UTF-8"'
        }),
        TRUSTED_ORIGIN
      )
    ).not.toThrow();
  });

  it.each([
    ["missing", undefined],
    ["null", "null"],
    ["mismatched", "https://evil.example"]
  ])("rejects a %s Origin", (_name, origin) => {
    const headers: Record<string, string | undefined> = { origin };
    expectErrorCode(
      () =>
        validateMutationRequest(
          mutationRequest("POST", headers),
          TRUSTED_ORIGIN
        ),
      "CSRF_REJECTED"
    );
  });

  it("rejects cross-site Fetch Metadata", () => {
    expectErrorCode(
      () =>
        validateMutationRequest(
          mutationRequest("POST", { "sec-fetch-site": "cross-site" }),
          TRUSTED_ORIGIN
        ),
      "CSRF_REJECTED"
    );
  });

  it.each([
    ["missing content type", { "content-type": undefined }],
    [
      "form content type",
      { "content-type": "application/x-www-form-urlencoded" }
    ],
    ["JSON suffix", { "content-type": "application/problem+json" }],
    ["extra parameter", { "content-type": "application/json; profile=test" }],
    ["missing custom header", { "x-knf-request": undefined }],
    ["wrong custom header", { "x-knf-request": "true" }]
  ])("rejects %s", (_name, headers) => {
    expectErrorCode(
      () =>
        validateMutationRequest(
          mutationRequest("POST", headers),
          TRUSTED_ORIGIN
        ),
      "CSRF_REJECTED"
    );
  });

  it("lets read-only GET and HEAD requests pass without mutation headers", () => {
    for (const method of ["GET", "HEAD"]) {
      expect(() =>
        validateMutationRequest(
          new Request("https://knf.example/api/favorites", { method })
        )
      ).not.toThrow();
    }
  });

  it("treats an invalid trusted origin as server unavailability", () => {
    expectErrorCode(
      () => validateMutationRequest(mutationRequest("POST"), "knf.example"),
      "PERSONALIZATION_UNAVAILABLE"
    );
  });
});

function mutationRequest(
  method: string,
  overrides: Record<string, string | undefined> = {}
): Request {
  const values: Record<string, string> = {
    origin: TRUSTED_ORIGIN,
    "sec-fetch-site": "same-origin",
    "content-type": "application/json; charset=utf-8",
    "x-knf-request": "1"
  };

  for (const [name, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete values[name];
    } else {
      values[name] = value;
    }
  }

  return new Request("https://knf.example/api/favorites", {
    method,
    headers: values,
    body: "{}"
  });
}

function expectErrorCode(operation: () => void, code: string): void {
  try {
    operation();
    throw new Error("Expected operation to throw.");
  } catch (error) {
    expect(error).toBeInstanceOf(PersonalizationApiError);
    expect((error as PersonalizationApiError).code).toBe(code);
  }
}
