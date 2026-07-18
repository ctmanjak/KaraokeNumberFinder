import { prismaAdapter } from "@better-auth/prisma-adapter";

import { getPrismaClient } from "../db/prisma";
import { readAuthEnvironment } from "./env";
import { createPrismaOAuthFlowStore } from "./oauth-flow-store";
import { createAuthRuntime, type AuthRuntime } from "./runtime";

let runtime: AuthRuntime | undefined;

export function getServerAuthRuntime(): AuthRuntime {
  if (runtime === undefined) {
    const prisma = getPrismaClient();
    const environment = readAuthEnvironment();
    runtime = createAuthRuntime({
      environment,
      database: prismaAdapter(prisma, {
        provider: "postgresql",
        transaction: true
      }),
      flowStore: createPrismaOAuthFlowStore(prisma),
      async revokeSessionToken(token) {
        await prisma.session.deleteMany({ where: { token } });
      }
    });
  }

  return runtime;
}

export function getServerAuth() {
  return getServerAuthRuntime().auth;
}
