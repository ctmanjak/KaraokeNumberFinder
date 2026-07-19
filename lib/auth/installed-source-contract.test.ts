import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("installed Better Auth 1.6.23 contract", () => {
  it("pins Better Auth and the official Prisma adapter to the exact patch", () => {
    const betterAuth = packageJson("better-auth");
    const prismaAdapter = packageJson("@better-auth/prisma-adapter");

    expect(betterAuth.version).toBe("1.6.23");
    expect(prismaAdapter.version).toBe("1.6.23");
  });

  it("uses database Verification plus a signed cookie for ten-minute state and S256 PKCE", () => {
    const stateSource = source("node_modules/better-auth/dist/state.mjs");
    const authorizationSource = source(
      "node_modules/@better-auth/core/dist/oauth2/create-authorization-url.mjs"
    );

    expect(stateSource).toContain("internalAdapter.createVerificationValue");
    expect(stateSource).toContain("setSignedCookie");
    expect(stateSource).toContain("setMinutes(expiresAt.getMinutes() + 10)");
    expect(stateSource).toContain("deleteVerificationByIdentifier(state)");
    expect(authorizationSource).toContain(
      'url.searchParams.set("code_challenge_method", "S256")'
    );
  });

  it("pins the installed callback gap that the verified Google mapper closes", () => {
    const callbackSource = source(
      "node_modules/better-auth/dist/api/routes/callback.mjs"
    );
    const googleSource = source(
      "node_modules/@better-auth/core/dist/social-providers/google.mjs"
    );
    const projectMapper = source("lib/auth/google-profile.ts");

    expect(callbackSource).not.toContain("verifyIdToken(");
    expect(googleSource).toContain("decodeJwt(token.idToken)");
    expect(projectMapper).toContain("verifyGoogleIdToken");
    expect(projectMapper).toContain("claims.iss !== GOOGLE_ISSUER");
    expect(projectMapper).toContain("claims.aud !== clientId");
    expect(projectMapper).toContain("claims.nonce !== nonce");
    expect(projectMapper).toContain("claims.email_verified !== true");
  });

  it("connects the official adapter to the Prisma 7 custom-output singleton", () => {
    const serverSource = source("lib/auth/server.ts");
    const prismaSource = source("lib/db/prisma.ts");

    expect(serverSource).toContain(
      'import { prismaAdapter } from "@better-auth/prisma-adapter"'
    );
    expect(serverSource).toContain("prismaAdapter(prisma");
    expect(prismaSource).toContain(
      'import { PrismaClient } from "../generated/prisma/client"'
    );
    expect(prismaSource).toContain("new PrismaPg");
  });
});

function packageJson(packageName: string): { version?: string } {
  return JSON.parse(
    source(path.join("node_modules", packageName, "package.json"))
  ) as { version?: string };
}

function source(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), "utf8");
}
