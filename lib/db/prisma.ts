import { PrismaPg } from "@prisma/adapter-pg";
import type { PoolConfig } from "pg";

import { PrismaClient } from "../generated/prisma/client";

type GlobalWithPrisma = typeof globalThis & {
  karaokeNumberFinderPrisma?: PrismaClient;
};

const globalForPrisma = globalThis as GlobalWithPrisma;
const PG_POOL_MAX_CONNECTIONS = 5;
const PG_POOL_CONNECTION_TIMEOUT_MS = 5_000;

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

  const config: PoolConfig = {
    connectionString,
    max: PG_POOL_MAX_CONNECTIONS,
    connectionTimeoutMillis: PG_POOL_CONNECTION_TIMEOUT_MS
  };

  if (rejectUnauthorized !== undefined && rejectUnauthorized.trim() !== "") {
    config.ssl = { rejectUnauthorized: rejectUnauthorized !== "false" };
  }

  return config;
}
