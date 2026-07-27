import { headers } from "next/headers";
import { forbidden } from "next/navigation";
import { AdminSongDetailPage } from "@/components/admin/AdminSongDetailPage";
import { getServerAdminCatalogPageAccess } from "@/lib/admin-catalog/server";

type PageProps = Readonly<{
  params: Promise<{ songId: string }>;
}>;

export default async function Page({ params }: PageProps) {
  const access = await getServerAdminCatalogPageAccess(
    new Headers(await headers()),
    "song_detail_page"
  );
  if (access.status === "feature_off") {
    forbidden();
  }
  const { songId } = await params;
  return <AdminSongDetailPage songId={songId} />;
}
