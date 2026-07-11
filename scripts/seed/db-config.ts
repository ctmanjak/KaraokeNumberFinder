import type { PoolConfig } from "pg";

export function createSeedPgPoolConfig(commandName: string): PoolConfig {
  const connectionString = process.env.DATABASE_URL;

  if (connectionString === undefined || connectionString.trim() === "") {
    throw new Error(
      `DATABASE_URL is required for ${commandName}.\nSet DATABASE_URL using the existing Prisma environment configuration, then rerun ${commandName}.`
    );
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
