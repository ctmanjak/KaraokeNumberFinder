import "dotenv/config";
import { defineConfig } from "prisma/config";

const FALLBACK_DATABASE_URL =
  "postgresql://prisma:prisma@localhost:5432/karaoke_number_finder?schema=public";

function prismaCliDatabaseUrl(): string {
  const configured = process.env.DATABASE_URL;

  return configured === undefined || configured.trim() === ""
    ? FALLBACK_DATABASE_URL
    : configured;
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations"
  },
  datasource: {
    url: prismaCliDatabaseUrl()
  }
});
