import { describe, expect, it, vi } from "vitest";

import { parseJsonBody, requireValidInput } from "./body";
import { createPersonalizationHandler } from "./handler";

const TRUSTED_ORIGIN = "https://knf.example";

describe("createPersonalizationHandler", () => {
  it("validates mutation CSRF before session and domain dependencies", async () => {
    const requireSession = vi.fn(async () => ({ user: { id: "user-a" } }));
    const domainHandler = vi.fn(async () => Response.json({ ok: true }));
    const handler = createHandler(domainHandler, requireSession);

    const response = await handler(
      new Request(`${TRUSTED_ORIGIN}/api/favorites`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-knf-request": "1"
        },
        body: "{}"
      })
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: { code: "CSRF_REJECTED" }
    });
    expect(requireSession).not.toHaveBeenCalled();
    expect(domainHandler).not.toHaveBeenCalled();
  });

  it("runs an authorized same-origin mutation", async () => {
    const requireSession = vi.fn(async () => ({ user: { id: "user-a" } }));
    const domainHandler = vi.fn(async ({ auth }) =>
      Response.json({ user_id: auth.user.id })
    );
    const handler = createHandler(domainHandler, requireSession);

    const response = await handler(jsonMutation("{}"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ user_id: "user-a" });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(requireSession).toHaveBeenCalledTimes(1);
    expect(domainHandler).toHaveBeenCalledTimes(1);
  });

  it("overrides unsafe success caching while preserving response metadata", async () => {
    const handler = createHandler(
      async () =>
        new Response("created", {
          status: 201,
          statusText: "Created",
          headers: {
            "cache-control": "public, max-age=3600",
            "x-domain-header": "preserved"
          }
        }),
      async () => ({ user: { id: "user-a" } })
    );

    const response = await handler(
      new Request(`${TRUSTED_ORIGIN}/api/favorites`)
    );

    expect(response.status).toBe(201);
    expect(response.statusText).toBe("Created");
    expect(response.headers.get("x-domain-header")).toBe("preserved");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.text()).toBe("created");
  });

  it("allows read-only GET without mutation headers", async () => {
    const handler = createHandler(
      async () => Response.json({ items: [] }),
      async () => ({ user: { id: "user-a" } })
    );

    const response = await handler(
      new Request(`${TRUSTED_ORIGIN}/api/favorites`)
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ items: [] });
  });

  it("maps malformed JSON and schema validation separately", async () => {
    const parseHandler = createHandler(
      async ({ request }) => {
        const input = await parseJsonBody(request);
        const body = requireValidInput(input, isNameBody);
        return Response.json(body);
      },
      async () => ({ user: { id: "user-a" } })
    );

    const malformed = await parseHandler(jsonMutation("{"));
    const invalid = await parseHandler(jsonMutation('{"name":42}'));

    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({
      error: { code: "INVALID_REQUEST" }
    });
    expect(invalid.status).toBe(422);
    expect(await invalid.json()).toMatchObject({
      error: { code: "VALIDATION_ERROR" }
    });
  });

  it("ignores an inbound request ID and uses a server-generated value", async () => {
    const handler = createHandler(
      async () => {
        throw new Error("internal");
      },
      async () => ({ user: { id: "user-a" } })
    );
    const response = await handler(
      new Request(`${TRUSTED_ORIGIN}/api/favorites`, {
        headers: { "x-request-id": "attacker-controlled" }
      })
    );

    expect(response.headers.get("x-request-id")).toBe("server-request-id");
    expect(await response.text()).not.toContain("attacker-controlled");
  });
});

function createHandler(
  handler: Parameters<typeof createPersonalizationHandler>[0],
  requireSession: Parameters<
    typeof createPersonalizationHandler
  >[1]["requireSession"]
) {
  return createPersonalizationHandler(handler, {
    requireSession,
    trustedOrigin: TRUSTED_ORIGIN,
    generateRequestId: () => "server-request-id",
    writeSafeLog: () => undefined
  });
}

function jsonMutation(body: string): Request {
  return new Request(`${TRUSTED_ORIGIN}/api/favorites`, {
    method: "POST",
    headers: {
      origin: TRUSTED_ORIGIN,
      "sec-fetch-site": "same-origin",
      "content-type": "application/json",
      "x-knf-request": "1"
    },
    body
  });
}

function isNameBody(input: unknown): input is { name: string } {
  return (
    typeof input === "object" &&
    input !== null &&
    "name" in input &&
    typeof input.name === "string"
  );
}
