import { headers } from "next/headers";
import { forbidden } from "next/navigation";
import { AdminSongPage } from "@/components/admin/AdminSongPage";
import { getServerAdminCatalogPageAccess } from "@/lib/admin-catalog/server";

export default async function Page() {
  const access = await getServerAdminCatalogPageAccess(
    new Headers(await headers()),
    "song_create_page"
  );
  if (access.status === "feature_off") {
    forbidden();
  }
  return <AdminSongPage />;
}
