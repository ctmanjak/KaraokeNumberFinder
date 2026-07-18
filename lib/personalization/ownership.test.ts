import { describe, expect, it, vi } from "vitest";

import { createPersonalizationHandler } from "./handler";
import {
  ownedWhere,
  requireActionPermission,
  requireOwnedResource
} from "./ownership";
import type { AuthContext } from "./session";

type Resource = {
  id: string;
  userId: string;
  value: string;
};

const resources: Resource[] = [
  { id: "resource-a", userId: "user-a", value: "private-a" },
  { id: "resource-b", userId: "user-b", value: "private-b" }
];

describe("personalization authorization and ownership", () => {
  it("builds ownership conditions from the authenticated user only", () => {
    const auth: AuthContext = { user: { id: "session-user" } };

    expect(ownedWhere(auth, { id: "resource-a" })).toEqual({
      id: "resource-a",
      userId: "session-user"
    });
  });

  it("hides cross-user resources behind the same 404 as missing resources", async () => {
    const findOwned = vi.fn(
      async (where: { id: string; userId: string }): Promise<Resource | null> =>
        resources.find(
          (resource) =>
            resource.id === where.id && resource.userId === where.userId
        ) ?? null
    );
    const crossUser = await representativeGetHandler(
      "user-b",
      "resource-a",
      findOwned
    );
    const missing = await representativeGetHandler(
      "user-b",
      "missing-resource",
      findOwned
    );
    const crossUserBody = await crossUser.json();
    const missingBody = await missing.json();

    expect(findOwned).toHaveBeenNthCalledWith(1, {
      id: "resource-a",
      userId: "user-b"
    });
    expect(crossUser.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(withoutRequestId(crossUserBody)).toEqual(
      withoutRequestId(missingBody)
    );
    expect(JSON.stringify(crossUserBody)).not.toContain("private-a");
  });

  it("returns an owned resource through the composite lookup", async () => {
    const findOwned = async (where: { id: string; userId: string }) =>
      resources.find(
        (resource) =>
          resource.id === where.id && resource.userId === where.userId
      ) ?? null;

    const response = await representativeGetHandler(
      "user-a",
      "resource-a",
      findOwned
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: "resource-a" });
  });

  it("maps insufficient action permission to 403", async () => {
    const handler = createPersonalizationHandler(
      async () => {
        requireActionPermission(false);
        return Response.json({ unreachable: true });
      },
      {
        requireSession: async () => ({ user: { id: "user-a" } }),
        trustedOrigin: "https://knf.example",
        generateRequestId: () => "permission-request",
        writeSafeLog: () => undefined
      }
    );

    const response = await handler(
      new Request("https://knf.example/api/test-resource")
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: { code: "FORBIDDEN" }
    });
  });
});

async function representativeGetHandler(
  userId: string,
  resourceId: string,
  findOwned: (where: { id: string; userId: string }) => Promise<Resource | null>
): Promise<Response> {
  const handler = createPersonalizationHandler(
    async ({ auth }) => {
      const resource = await requireOwnedResource(
        auth,
        { id: resourceId },
        findOwned
      );
      return Response.json({ id: resource.id });
    },
    {
      requireSession: async () => ({ user: { id: userId } }),
      trustedOrigin: "https://knf.example",
      generateRequestId: () => `request-${resourceId}`,
      writeSafeLog: () => undefined
    }
  );

  return handler(new Request("https://knf.example/api/test-resource"));
}

function withoutRequestId(body: unknown): unknown {
  const envelope = body as {
    error: { code: string; message: string; request_id: string };
  };
  return {
    error: {
      code: envelope.error.code,
      message: envelope.error.message
    }
  };
}
