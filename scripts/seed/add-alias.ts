import { addAliasRow } from "../../lib/seed/add";
import { collectFields, runSeedAddCli } from "./add-common";

await runSeedAddCli(process.argv.slice(2), async (args) => {
  const fields = await collectFields(args, [
    { key: "song-id", prompt: "song_id", required: true },
    { key: "alias", prompt: "alias", required: true },
    { key: "language", prompt: "language", required: true },
    { key: "alias-type", prompt: "alias_type", required: true },
    { key: "source-url", prompt: "source_url" },
    { key: "source-name", prompt: "source_name" },
    { key: "verified-by", prompt: "verified_by", required: true },
    { key: "verification-note", prompt: "verification_note" }
  ]);

  return addAliasRow(
    {
      song_id: fields["song-id"],
      alias: fields.alias,
      language: fields.language,
      alias_type: fields["alias-type"],
      source_url: fields["source-url"],
      source_name: fields["source-name"],
      verified_by: fields["verified-by"],
      verification_note: fields["verification-note"]
    },
    { seedDir: args.seedDir }
  );
});
