import { getChatGPTUser, loginPath } from "@/app/chatgpt-auth";
import { NyaScansApp } from "@/components/nyascans/NyaScansApp";
import { getActor } from "@/lib/server/policy";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Team Workspace",
  robots: { index: false, follow: false },
};

type DashboardPageProps = {
  params: Promise<{ slug?: string[] }>;
};

export default async function DashboardPage({ params }: DashboardPageProps) {
  const { slug } = await params;
  const user = await getChatGPTUser();
  if (!user) {
    return (
      <NyaScansApp
        view="access"
        actor={null}
        signInPath={loginPath("/dashboard")}
      />
    );
  }

  let actor: Awaited<ReturnType<typeof getActor>> = null;
  try {
    actor = await getActor();
  } catch {
    actor = null;
  }

  if (
    !actor ||
    (actor.primaryRole !== "MODERATOR" && !actor.canUseUploadCenter)
  ) {
    return (
      <NyaScansApp
        view="access"
        actor={{
          displayName: user.displayName,
          email: user.email,
          role: actor?.primaryRole ?? "USER",
          roles: actor?.roles ?? ["USER"],
          avatarUrl: actor?.avatarUrl ?? null,
        }}
      />
    );
  }

  return (
    <NyaScansApp
      view="dashboard"
      resourceSlug={
        actor.primaryRole === "MODERATOR" ? "comments" : slug?.[0]
      }
      operationPath={
        actor.primaryRole === "MODERATOR" ? ["comments"] : slug ?? []
      }
      actor={{
        displayName: actor.displayName,
        email: actor.email,
        role: actor.primaryRole,
        roles: actor.roles,
        avatarUrl: actor.avatarUrl,
        canUseUploadCenter: actor.canUseUploadCenter,
        canUpload:
          ["OWNER", "ADMINISTRATOR"].includes(actor.primaryRole) ||
          actor.uploadTeamIds.length > 0,
        canRequestSeries:
          ["OWNER", "ADMINISTRATOR"].includes(actor.primaryRole) ||
          actor.requestTeamIds.length > 0,
        canManageTeam:
          ["OWNER", "ADMINISTRATOR"].includes(actor.primaryRole) ||
          actor.managedTeamIds.length > 0,
      }}
    />
  );
}
