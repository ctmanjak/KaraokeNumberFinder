import type { GenericEndpointContext } from "better-auth";
import { describe, expect, it } from "vitest";

import {
  SESSION_ABSOLUTE_TTL_SECONDS,
  SESSION_IDLE_TTL_SECONDS
} from "./policy";
import {
  absoluteExpiry,
  capNewSessionExpiry,
  capSessionRefresh
} from "./session-policy";

describe("session absolute expiry policy", () => {
  const createdAt = new Date("2026-01-01T00:00:00.000Z");

  it("keeps the initial seven-day idle expiry", () => {
    const expiresAt = new Date(
      createdAt.getTime() + SESSION_IDLE_TTL_SECONDS * 1_000
    );

    expect(
      capNewSessionExpiry({ createdAt, expiresAt, token: "not-returned" })
        .expiresAt
    ).toEqual(expiresAt);
  });

  it("caps refreshes at 30 days from creation", () => {
    const requested = new Date(
      createdAt.getTime() + (SESSION_ABSOLUTE_TTL_SECONDS + 86_400) * 1_000
    );
    const context = {
      context: { session: { session: { createdAt } } }
    } as GenericEndpointContext;

    expect(
      capSessionRefresh({ expiresAt: requested }, context)?.expiresAt
    ).toEqual(absoluteExpiry(createdAt));
  });

  it("fails closed when a refresh has no authoritative current session", () => {
    expect(capSessionRefresh({ expiresAt: new Date() }, null)).toBeNull();
  });
});
