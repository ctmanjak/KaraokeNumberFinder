import { describe, expect, it } from "vitest";

import {
  hasPrismaErrorCode,
  isPostgresStatementTimeout,
  isPrismaTransactionWriteConflict
} from "./prisma-error";

describe("Prisma driver-adapter error classification", () => {
  it("finds PostgreSQL statement cancellation inside a P2010 adapter wrapper", () => {
    const driverAdapterError = {
      name: "DriverAdapterError",
      cause: {
        kind: "postgres",
        code: "57014",
        originalCode: "57014",
        originalMessage: "canceling statement due to statement timeout"
      }
    };

    expect(
      isPostgresStatementTimeout({
        code: "P2010",
        meta: { driverAdapterError }
      })
    ).toBe(true);
    expect(isPostgresStatementTimeout({ code: "P2010", meta: {} })).toBe(false);
  });

  it("finds transaction conflicts emitted directly by the adapter", () => {
    const driverAdapterError = {
      name: "DriverAdapterError",
      cause: {
        kind: "TransactionWriteConflict",
        originalCode: "40001"
      }
    };

    expect(isPrismaTransactionWriteConflict(driverAdapterError)).toBe(true);
    expect(
      isPrismaTransactionWriteConflict({
        meta: { driverAdapterError }
      })
    ).toBe(true);
    expect(isPrismaTransactionWriteConflict({ code: "P2002" })).toBe(false);
  });

  it("finds Prisma error codes through nested metadata without following arbitrary fields", () => {
    expect(
      hasPrismaErrorCode(
        { meta: { driverAdapterError: { cause: { code: "P2034" } } } },
        ["P2002", "P2034"]
      )
    ).toBe(true);
    expect(
      hasPrismaErrorCode({ unrelated: { code: "P2034" } }, ["P2034"])
    ).toBe(false);
  });
});
