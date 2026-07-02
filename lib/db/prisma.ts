import { PrismaPg } from "@prisma/adapter-pg";
import type { PoolConfig } from "pg";

import { PrismaClient } from "../generated/prisma/client";

type GlobalWithPrisma = typeof globalThis & {
  karaokeNumberFinderPrisma?: PrismaClient;
};

const globalForPrisma = globalThis as GlobalWithPrisma;

export function getPrismaClient(): PrismaClient {
  if (globalForPrisma.karaokeNumberFinderPrisma === undefined) {
    const adapter = new PrismaPg(createPgPoolConfig());
    globalForPrisma.karaokeNumberFinderPrisma = new PrismaClient({ adapter });
  }

  return globalForPrisma.karaokeNumberFinderPrisma;
}

function createPgPoolConfig(): PoolConfig {
  const connectionString = process.env.DATABASE_URL;

  if (connectionString === undefined || connectionString.trim() === "") {
    throw new Error("DATABASE_URL is required to access the application DB.");
  }

  const rejectUnauthorized = process.env.DATABASE_SSL_REJECT_UNAUTHORIZED;

  if (rejectUnauthorized === undefined || rejectUnauthorized.trim() === "") {
    return { connectionString };
  }

  return {
    connectionString,
    ssl: { rejectUnauthorized: rejectUnauthorized !== "false" }
  };
}
