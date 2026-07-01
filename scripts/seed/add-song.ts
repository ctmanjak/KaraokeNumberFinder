import { addSongRow } from "../../lib/seed/add";
import { collectFields, runSeedAddCli } from "./add-common";

await runSeedAddCli(process.argv.slice(2), async (args) => {
  const fields = await collectFields(args, [
    { key: "original-language", prompt: "original_language", required: true },
    { key: "canonical-title", prompt: "canonical_title", required: true },
    { key: "display-title", prompt: "display_title", required: true },
    { key: "canonical-artist", prompt: "canonical_artist", required: true },
    { key: "release-year", prompt: "release_year" },
    { key: "tie-in", prompt: "tie_in" },
    { key: "source-url", prompt: "source_url" },
    { key: "source-name", prompt: "source_name" },
    { key: "verified-by", prompt: "verified_by", required: true },
    { key: "verification-note", prompt: "verification_note" }
  ]);

  return addSongRow(
    {
      original_language: fields["original-language"],
      canonical_title: fields["canonical-title"],
      display_title: fields["display-title"],
      canonical_artist: fields["canonical-artist"],
      release_year: fields["release-year"],
      tie_in: fields["tie-in"],
      source_url: fields["source-url"],
      source_name: fields["source-name"],
      verified_by: fields["verified-by"],
      verification_note: fields["verification-note"]
    },
    { seedDir: args.seedDir }
  );
});
