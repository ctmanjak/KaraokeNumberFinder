import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { makeSignature } from "better-auth/crypto";

import { getServerAuth } from "../auth/server";
import { authCookiePolicy, SESSION_IDLE_TTL_SECONDS } from "../auth/policy";
import { getPrismaClient } from "../db/prisma";
import { readAuthEnvironment } from "../auth/env";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MAX_DISPLAY_NAME_LENGTH = 80;

export async function readBrowserE2EFixtures(): Promise<Response> {
  const prisma = getPrismaClient();
  const [songs, providers] = await Promise.all([
    prisma.song.findMany({
      where: { aliases: { some: {} } },
      orderBy: { id: "asc" },
      take: 3,
      select: {
        id: true,
        displayTitle: true,
        aliases: {
          orderBy: { id: "asc" },
          take: 1,
          select: { alias: true }
        }
      }
    }),
    prisma.karaokeProvider.findMany({
      where: { isActive: true },
      orderBy: [{ displayOrder: "asc" }, { name: "asc" }, { id: "asc" }],
      select: { id: true, name: true }
    })
  ]);

  return Response.json(
    {
      songs: songs.flatMap((song) => {
        const query = song.aliases[0]?.alias;
        return query === undefined
          ? []
          : [
              {
                id: song.id,
                query,
                display_title: song.displayTitle
              }
            ];
      }),
      providers
    },
    { headers: { "cache-control": "no-store" } }
  );
}

export async function createBrowserE2ESession(
  request: Request
): Promise<Response> {
  const body = await readJsonObject(request);
  if (
    body === null ||
    !hasExactKeys(
      body,
      ["action", "display_name", "user_id"],
      ["oauth_state"]
    ) ||
    body.action !== "login" ||
    typeof body.user_id !== "string" ||
    !UUID_PATTERN.test(body.user_id) ||
    typeof body.display_name !== "string" ||
    body.display_name.trim() !== body.display_name ||
    body.display_name.length === 0 ||
    body.display_name.length > MAX_DISPLAY_NAME_LENGTH ||
    (body.oauth_state !== undefined &&
      (typeof body.oauth_state !== "string" ||
        body.oauth_state.length < 32 ||
        body.oauth_state.length > 512))
  ) {
    return invalidRequest();
  }

  const authEnvironment = readAuthEnvironment();
  const cookie = authCookiePolicy(authEnvironment.production);
  const auth = getServerAuth();
  const existingSession = await auth.api.getSession({
    headers: request.headers,
    query: { disableCookieCache: true, disableRefresh: true }
  });
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_IDLE_TTL_SECONDS * 1_000);
  const prisma = getPrismaClient();

  await prisma.$transaction(async (transaction) => {
    if (existingSession?.session.token !== undefined) {
      await transaction.session.deleteMany({
        where: { token: existingSession.session.token }
      });
    }

    await transaction.user.upsert({
      where: { id: body.user_id as string },
      create: {
        id: body.user_id as string,
        name: body.display_name as string,
        email: `${body.user_id as string}@e2e.invalid`,
        emailVerified: true
      },
      update: {
        name: body.display_name as string,
        emailVerified: true
      }
    });
    await transaction.session.create({
      data: {
        token,
        userId: body.user_id as string,
        expiresAt,
        userAgent: "KaraokeNumberFinder browser E2E"
      }
    });

    if (typeof body.oauth_state === "string") {
      await transaction.verification.deleteMany({
        where: {
          identifier: {
            in: [body.oauth_state, oauthReplayIdentifier(body.oauth_state)]
          }
        }
      });
    }
  });

  const signedToken = `${token}.${await makeSignature(
    token,
    authEnvironment.secret
  )}`;
  const headers = new Headers({
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8"
  });
  headers.append(
    "set-cookie",
    `${cookie.sessionCookieName}=${signedToken}; Path=/; Max-Age=${SESSION_IDLE_TTL_SECONDS}; HttpOnly; SameSite=Lax${cookie.secure ? "; Secure" : ""}`
  );
  headers.append(
    "set-cookie",
    `${cookie.stateCookieName}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${cookie.secure ? "; Secure" : ""}`
  );

  return new Response(
    JSON.stringify({
      authenticated: true,
      user: { id: body.user_id, name: body.display_name }
    }),
    { status: 200, headers }
  );
}

function oauthReplayIdentifier(state: string): string {
  const digest = createHash("sha256").update(state).digest("base64url");
  return `knf-oauth-replay:${digest}`;
}

export async function cleanupBrowserE2EUsers(
  request: Request
): Promise<Response> {
  const body = await readJsonObject(request);
  if (
    body === null ||
    !hasExactKeys(body, ["user_ids"]) ||
    !Array.isArray(body.user_ids) ||
    body.user_ids.length === 0 ||
    body.user_ids.length > 20 ||
    !body.user_ids.every(
      (value): value is string =>
        typeof value === "string" && UUID_PATTERN.test(value)
    )
  ) {
    return invalidRequest();
  }

  const deleted = await getPrismaClient().user.deleteMany({
    where: {
      id: { in: body.user_ids },
      email: { endsWith: "@e2e.invalid" }
    }
  });
  return Response.json(
    { deleted_count: deleted.count },
    { headers: { "cache-control": "no-store" } }
  );
}

function hasExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = []
): boolean {
  const allowed = new Set([...required, ...optional]);
  return (
    required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => allowed.has(key))
  );
}

async function readJsonObject(
  request: Request
): Promise<Record<string, unknown> | null> {
  try {
    const value = (await request.json()) as unknown;
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function invalidRequest(): Response {
  return Response.json(
    { error: { code: "INVALID_REQUEST", message: "Invalid E2E request." } },
    { status: 400, headers: { "cache-control": "no-store" } }
  );
}
