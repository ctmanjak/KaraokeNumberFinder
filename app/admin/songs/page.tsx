import { headers } from "next/headers";
import { forbidden } from "next/navigation";
import { AdminSongListPage } from "@/components/admin/AdminSongListPage";
import { getServerAdminCatalogPageAccess } from "@/lib/admin-catalog/server";

export default async function Page() {
  const access = await getServerAdminCatalogPageAccess(
    new Headers(await headers()),
    "songs_list_page"
  );
  if (access.status === "feature_off") {
    forbidden();
  }
  return <AdminSongListPage />;
}
