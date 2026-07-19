import type { GenericEndpointContext } from "better-auth";

import { SESSION_ABSOLUTE_TTL_SECONDS } from "./policy";

type SessionDates = {
  createdAt: Date;
  expiresAt: Date;
};

export function capNewSessionExpiry<T extends SessionDates>(session: T): T {
  return {
    ...session,
    expiresAt: minimumDate(session.expiresAt, absoluteExpiry(session.createdAt))
  };
}

export function capSessionRefresh(
  update: { expiresAt?: Date; [key: string]: unknown },
  context: GenericEndpointContext | null
): { expiresAt?: Date; [key: string]: unknown } | null {
  const current = context?.context.session?.session;
  if (
    current === undefined ||
    update.expiresAt === undefined ||
    !(current.createdAt instanceof Date)
  ) {
    return null;
  }

  return {
    ...update,
    expiresAt: minimumDate(update.expiresAt, absoluteExpiry(current.createdAt))
  };
}

export function absoluteExpiry(createdAt: Date): Date {
  return new Date(createdAt.getTime() + SESSION_ABSOLUTE_TTL_SECONDS * 1_000);
}

function minimumDate(first: Date, second: Date): Date {
  return first.getTime() <= second.getTime() ? first : second;
}
