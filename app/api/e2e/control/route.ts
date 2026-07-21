import {
  cleanupBrowserE2EUsers,
  createBrowserE2ESession,
  readBrowserE2EFixtures
} from "@/lib/e2e/control";
import { isBrowserE2ERequest } from "@/lib/e2e/guard";

export async function GET(request: Request): Promise<Response> {
  return isBrowserE2ERequest(request)
    ? readBrowserE2EFixtures()
    : notFoundResponse();
}

export async function POST(request: Request): Promise<Response> {
  return isBrowserE2ERequest(request)
    ? createBrowserE2ESession(request)
    : notFoundResponse();
}

export async function DELETE(request: Request): Promise<Response> {
  return isBrowserE2ERequest(request)
    ? cleanupBrowserE2EUsers(request)
    : notFoundResponse();
}

function notFoundResponse(): Response {
  return Response.json(
    { error: { code: "NOT_FOUND", message: "Not found." } },
    { status: 404, headers: { "cache-control": "no-store" } }
  );
}
