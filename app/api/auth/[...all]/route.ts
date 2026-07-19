import type { AuthFrameworkHandlers } from "../../../../lib/auth/route-handler";
import { getServerAuthRuntime } from "../../../../lib/auth/server";
import { createUnavailableAuthResponse } from "../../../../lib/auth/unavailable-response";

let handlers: AuthFrameworkHandlers | undefined;

export async function GET(request: Request): Promise<Response> {
  try {
    handlers ??= getServerAuthRuntime().handlers;
    return await handlers.GET(request);
  } catch {
    return unavailableResponse(request);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    handlers ??= getServerAuthRuntime().handlers;
    return await handlers.POST(request);
  } catch {
    return unavailableResponse(request);
  }
}

function unavailableResponse(request: Request): Response {
  return createUnavailableAuthResponse(
    request,
    process.env.NODE_ENV === "production"
  );
}
