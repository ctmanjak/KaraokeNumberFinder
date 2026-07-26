import { readJson } from "../http/client";

export async function fetchAdminCatalogAccess(
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal
): Promise<boolean> {
  const response = await fetcher("/api/admin/catalog-access", {
    cache: "no-store",
    headers: { accept: "application/json" },
    signal
  });
  if (!response.ok) {
    return false;
  }

  const body = await readJson(response);
  return (
    typeof body === "object" &&
    body !== null &&
    !Array.isArray(body) &&
    Object.keys(body).length === 1 &&
    "enabled" in body &&
    body.enabled === true
  );
}
