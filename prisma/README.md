# Prisma

This directory contains the Prisma setup for `[M1-T02]`.

`schema.prisma` intentionally contains only:

- Prisma Client generator using the Prisma 7 `prisma-client` provider
- Explicit generated client output at `lib/generated/prisma`
- PostgreSQL datasource provider

Domain models and migrations are reserved for `[M1-T03]`.

Prisma 7 reads the database connection URL from the root `prisma.config.ts`, not from a `url` field inside `schema.prisma`.

## Local database

Prisma reads the PostgreSQL connection string from `DATABASE_URL` through `prisma.config.ts`.

```bash
cp .env.example .env
```

Update `.env` with your local database credentials:

```dotenv
DATABASE_URL="postgresql://user:password@localhost:5432/karaoke_number_finder?schema=public"
```

Use any local PostgreSQL installation for development. For example, with Homebrew:

```bash
brew install postgresql@16
brew services start postgresql@16
createdb karaoke_number_finder
```

Docker Compose is not required for T02. If you prefer Docker, run a local PostgreSQL container and point `DATABASE_URL` at that container.

## Prisma 7 config

The root `prisma.config.ts` loads `.env` and passes the connection string to Prisma CLI:

```ts
import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations"
  },
  datasource: {
    url: env("DATABASE_URL")
  }
});
```

`schema.prisma` keeps only the datasource provider:

```prisma
datasource db {
  provider = "postgresql"
}
```

## Commands

```bash
npm run db:validate
npm run db:generate
npm run db:studio
```

`db:validate` checks that `schema.prisma` and `prisma.config.ts` are valid. `db:generate` generates Prisma Client into `lib/generated/prisma`. `db:studio` opens Prisma Studio after the database is reachable.

T02 does not create migrations because no Prisma models exist yet.
