import { createHash } from "node:crypto";

import type { PrismaClient } from "../generated/prisma/client";

const REPLAY_GUARD_PREFIX = "knf-oauth-replay:";

export type OAuthFlowStore = {
  register(state: string, expiresAt: Date): Promise<void>;
  consume(state: string, now: Date): Promise<boolean>;
  abort(state: string): Promise<void>;
};

type OAuthFlowPrismaClient = Pick<PrismaClient, "verification">;

export function createPrismaOAuthFlowStore(
  prisma: OAuthFlowPrismaClient
): OAuthFlowStore {
  return {
    async register(state, expiresAt) {
      await prisma.verification.create({
        data: {
          identifier: replayIdentifier(state),
          value: "single-use",
          expiresAt
        }
      });
    },
    async consume(state, now) {
      const identifier = replayIdentifier(state);
      const result = await prisma.verification.deleteMany({
        where: {
          identifier,
          expiresAt: { gt: now }
        }
      });

      if (result.count === 0) {
        await prisma.verification.deleteMany({ where: { identifier } });
      }

      return result.count === 1;
    },
    async abort(state) {
      await prisma.verification.deleteMany({
        where: {
          identifier: { in: [state, replayIdentifier(state)] }
        }
      });
    }
  };
}

function replayIdentifier(state: string): string {
  return `${REPLAY_GUARD_PREFIX}${createHash("sha256").update(state).digest("base64url")}`;
}
