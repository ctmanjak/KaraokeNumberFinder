import { Client } from "pg";
import {
  preflightSongIdentity,
  requireDisposableAdminSongDatabaseUrl
} from "../../lib/song-identity/maintenance";

const databaseUrl = requireDisposableAdminSongDatabaseUrl(
  process.env.DATABASE_URL,
  process.env.ADMIN_SONG_DISPOSABLE_DB_CONFIRMED
);
const client = new Client({ connectionString: databaseUrl });
await client.connect();
try {
  const report = await preflightSongIdentity(client);
  console.log(JSON.stringify(report, null, 2));
  if (report.release_blocked) process.exitCode = 1;
} finally {
  await client.end();
}
