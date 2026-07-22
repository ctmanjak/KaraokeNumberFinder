# Prisma

This directory contains the Prisma setup for the public search schema and the M3 authentication and user-data schema.

`schema.prisma` contains:

- Prisma Client generator using the Prisma 7 `prisma-client` provider
- Explicit generated client output at `lib/generated/prisma`
- PostgreSQL datasource provider
- Public search-loop models: `Song`, `SongAlias`, `KaraokeProvider`, `KaraokeEntry`
- M3 authentication models: `User`, `Account`, `Session`, `Verification`
- M3 personalization models: `UserPreference`, `Favorite`, `SearchHistory`
- Search and karaoke status enums: `AliasType`, `AvailabilityStatus`

Prisma 7 reads the database connection URL from the root `prisma.config.ts`, not from a `url` field inside `schema.prisma`.

The M3 schema is applied by `20260718121000_add_auth_user_data_schema`. Its deployment, constraint checks, recovery limits, and reviewed down-SQL draft are documented in [`docs/m3-t02-migration-runbook.md`](../docs/m3-t02-migration-runbook.md).

## Local database

Prisma reads the PostgreSQL connection string from `DATABASE_URL` through `prisma.config.ts`.

```bash
cp .env.example .env
```

Update `.env` with your local database credentials:

```dotenv
DATABASE_URL="postgresql://user:password@localhost:5432/karaoke_number_finder?schema=public"
```

Use any local PostgreSQL installation for development. Never point migration, seed, M3 DB, or browser E2E rehearsal commands at staging or production. For example, with Homebrew:

```bash
brew install postgresql@16
brew services start postgresql@16
createdb karaoke_number_finder
```

Docker Compose is not required. If you prefer Docker, run a local PostgreSQL container and point `DATABASE_URL` at that container.

M3 DB and browser E2E tests accept only `M3_TEST_DATABASE_URL` values for loopback PostgreSQL with the exact database name `karaoke_number_finder_m3_test`. The scripts fail before connecting for remote hosts or any other database name.

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

M3 auth and personalization IDs are native UUIDs. Ownership and deduplication are enforced by foreign keys and unique constraints, including `(providerId, accountId)`, session token, `(userId, songId)`, and `(userId, normalizedQuery)`. Provider deletion sets `UserPreference.defaultProviderId` to null; user deletion cascades only that user's auth and personalization rows.

## Commands

```bash
npm run db:validate
npx prisma migrate dev --name <migration_name>
npm run db:generate
npm run db:studio
```

`db:validate` checks that `schema.prisma` and `prisma.config.ts` are valid. `db:generate` generates Prisma Client into `lib/generated/prisma`. `db:studio` opens Prisma Studio after the database is reachable.

Use `npx prisma migrate dev --name <migration_name>` after changing the schema locally. The generated migration is committed under `prisma/migrations`; the generated Prisma Client under `lib/generated/prisma` is ignored and should not be committed.

Apply committed migrations to a new disposable DB and run the M3 constraint/repository suite with:

```bash
M3_TEST_DATABASE_URL=postgresql://USER:PASSWORD@127.0.0.1:PORT/karaoke_number_finder_m3_test \
  npm run test:m3-db
```

The runner executes `prisma migrate deploy` before the PostgreSQL-backed checks. Shared or production deployment must use the reviewed procedure in `docs/m3-t02-migration-runbook.md`; do not use `migrate dev`, `db push`, or `migrate reset` there.
