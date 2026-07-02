import { describe, expect, it, vi } from "vitest";

import { createProvidersGetHandler } from "./route-handler";

describe("createProvidersGetHandler", () => {
  it("returns provider items as JSON", async () => {
    const GET = createProvidersGetHandler(async () => [
      {
        id: "provider_alpha",
        name: "Generic Provider Alpha",
        country: "KR",
        is_active: true,
        display_order: 10,
        is_default: true,
        last_catalog_updated_at: null
      }
    ]);

    const response = await GET(new Request("http://localhost/api/providers"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      items: [
        {
          id: "provider_alpha",
          name: "Generic Provider Alpha",
          country: "KR",
          is_active: true,
          display_order: 10,
          is_default: true,
          last_catalog_updated_at: null
        }
      ]
    });
  });

  it("returns a 400 error for invalid query values", async () => {
    const GET = createProvidersGetHandler(async () => []);

    const response = await GET(
      new Request("http://localhost/api/providers?active_only=1")
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INVALID_QUERY",
        message: "active_only must be either true or false."
      }
    });
  });

  it("returns a 400 error for invalid country values", async () => {
    const GET = createProvidersGetHandler(async () => []);

    const response = await GET(
      new Request("http://localhost/api/providers?country=KOR")
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INVALID_COUNTRY",
        message: "country must be an ISO 3166-1 alpha-2 uppercase code."
      }
    });
  });

  it("returns a sanitized 500 error when provider lookup fails", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const GET = createProvidersGetHandler(async () => {
      throw new Error("database connection details");
    });

    const response = await GET(new Request("http://localhost/api/providers"));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "PROVIDER_LIST_FAILED",
        message: "Failed to list providers."
      }
    });
    expect(consoleError).toHaveBeenCalledOnce();
    consoleError.mockRestore();
  });
});
