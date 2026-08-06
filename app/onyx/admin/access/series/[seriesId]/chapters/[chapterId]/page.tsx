import { getAuthenticatedUser, loginPath } from "@/app/chatgpt-auth";
import { NyaScansApp } from "@/components/nyascans/NyaScansApp";
import { ChapterManagementWorkspace } from "@/components/nyascans/ChapterManagementWorkspace";
import { requireChapterManagementScope } from "@/lib/server/chapter-management";
import { getActor } from "@/lib/server/policy";
import { forbidden } from "next/navigation";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Manage Chapter",
  robots: { index: false, follow: false, noarchive: true },
};

type ChapterManagementPageProps = {
  params: Promise<{ seriesId: string; chapterId: string }>;
};

export default async function AdminChapterManagementPage({
  params,
}: ChapterManagementPageProps) {
  const { seriesId, chapterId } = await params;
  const returnTo =
    `/onyx/admin/access/series/${encodeURIComponent(seriesId)}` +
    `/chapters/${encodeURIComponent(chapterId)}`;
  const identity = await getAuthenticatedUser();
  if (!identity) {
    return (
      <NyaScansApp
        view="access"
        actor={null}
        adminGate
        signInPath={loginPath(returnTo)}
      />
    );
  }
  let actor: Awaited<ReturnType<typeof getActor>>;
  try {
    actor = await getActor();
  } catch {
    forbidden();
  }
  if (
    !actor ||
    !["OWNER", "ADMINISTRATOR"].includes(actor.primaryRole)
  ) {
    forbidden();
  }
  try {
    await requireChapterManagementScope(actor, seriesId, chapterId);
  } catch {
    forbidden();
  }
  return (
    <ChapterManagementWorkspace
      seriesId={seriesId}
      chapterId={chapterId}
      administration
      actor={{
        displayName: actor.displayName,
        role: actor.primaryRole,
      }}
    />
  );
}
