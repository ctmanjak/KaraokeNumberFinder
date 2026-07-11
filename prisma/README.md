# Prisma

This directory contains the Prisma setup and first milestone schema.

`schema.prisma` contains:

- Prisma Client generator using the Prisma 7 `prisma-client` provider
- Explicit generated client output at `lib/generated/prisma`
- PostgreSQL datasource provider
- First milestone search-loop models: `Song`, `SongAlias`, `KaraokeProvider`, `KaraokeEntry`
- Search and karaoke status enums: `AliasType`, `AvailabilityStatus`

Prisma 7 reads the database connection URL from the root `prisma.config.ts`, not from a `url` field inside `schema.prisma`.

Authentication and user-data models are intentionally not part of this milestone schema. `User`, `Favorite`, `SearchHistory`, and `UserPreference` should be added in a later authentication milestone.

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

Docker Compose is not required for the first milestone. If you prefer Docker, run a local PostgreSQL container and point `DATABASE_URL` at that container.

## Prisma 7 config

The root `prisma.config.ts` loads `.env` and passes the connection string to Prisma CLI. It falls back to a local placeholder URL so `prisma generate` and build/typecheck/test pre-scripts can run in a clean checkout before a real database is configured:

```ts
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
```

Application runtime code and DB-backed seed/perf scripts still require a real `DATABASE_URL` before opening a database connection.

`schema.prisma` keeps only the datasource provider in the datasource block:

```prisma
datasource db {
  provider = "postgresql"
}
```

## Schema notes

The stable IDs are explicit strings because seed CSV files own the public identifiers. Prisma and PostgreSQL do not generate `Song`, `SongAlias`, `KaraokeProvider`, or `KaraokeEntry` IDs automatically.

Model fields use Prisma-friendly camelCase and map to snake_case database tables and columns. This keeps TypeScript usage ergonomic while matching the CSV/API naming convention in the database.

Timestamps are database-managed:

- `created_at` uses `now()`
- `updated_at` uses Prisma `@updatedAt`

Provider names and counts are data only. The schema must not encode specific providers.

## Commands

```bash
npm run db:validate
npx prisma migrate dev --name add_core_search_schema
npm run db:generate
npm run db:studio
```

`db:validate` checks that `schema.prisma` and `prisma.config.ts` are valid. `db:generate` generates Prisma Client into `lib/generated/prisma`. `db:studio` opens Prisma Studio after the database is reachable.

Use `npx prisma migrate dev --name add_core_search_schema` after changing the schema locally. The generated migration is committed under `prisma/migrations`; the generated Prisma Client under `lib/generated/prisma` is ignored and should not be committed.
