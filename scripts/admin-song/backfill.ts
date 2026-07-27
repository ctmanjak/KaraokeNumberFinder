import { Client } from "pg";
import {
  backfillSongIdentity,
  requireDisposableAdminSongDatabaseUrl
} from "../../lib/song-identity/maintenance";

const databaseUrl = requireDisposableAdminSongDatabaseUrl(
  process.env.DATABASE_URL,
  process.env.ADMIN_SONG_DISPOSABLE_DB_CONFIRMED
);
const dryRun = process.argv.includes("--dry-run");
const client = new Client({ connectionString: databaseUrl });
await client.connect();
try {
  const report = await backfillSongIdentity(client, { dryRun });
  console.log(JSON.stringify(report, null, 2));
  if (report.before.backfill_blocked || report.after.release_blocked) {
    process.exitCode = 1;
  }
} finally {
  await client.end();
}
