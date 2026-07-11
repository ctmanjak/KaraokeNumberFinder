import { addEntryRow, readProviderChoices } from "../../lib/seed/add";
import { collectFields, runSeedAddCli } from "./add-common";

await runSeedAddCli(process.argv.slice(2), async (args) => {
  if (!args.values.has("provider-id")) {
    const providers = readProviderChoices(args.seedDir);

    if (providers.length > 0) {
      console.log("Providers:");
      for (const provider of providers) {
        console.log(`- ${provider}`);
      }
    }
  }

  const fields = await collectFields(args, [
    { key: "song-id", prompt: "song_id", required: true },
    { key: "provider-id", prompt: "provider_id", required: true },
    { key: "karaoke-number", prompt: "karaoke_number" },
    { key: "version-info", prompt: "version_info" },
    {
      key: "availability-status",
      prompt: "availability_status",
      required: true
    },
    { key: "last-verified-at", prompt: "last_verified_at" },
    { key: "source-url", prompt: "source_url" },
    { key: "source-name", prompt: "source_name", required: true },
    { key: "verified-by", prompt: "verified_by" },
    { key: "verification-note", prompt: "verification_note" }
  ]);

  return addEntryRow(
    {
      song_id: fields["song-id"],
      provider_id: fields["provider-id"],
      karaoke_number: fields["karaoke-number"],
      version_info: fields["version-info"],
      availability_status: fields["availability-status"],
      last_verified_at: fields["last-verified-at"],
      source_url: fields["source-url"],
      source_name: fields["source-name"],
      verified_by: fields["verified-by"],
      verification_note: fields["verification-note"]
    },
    { seedDir: args.seedDir }
  );
});
