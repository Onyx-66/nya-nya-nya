import { getAuthenticatedUser, loginPath } from "@/app/chatgpt-auth";
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
  const user = await getAuthenticatedUser();
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

  if (!actor) {
    return (
      <NyaScansApp
        view="access"
        actor={{
          displayName: user.displayName,
          email: user.email,
          role: "USER",
          roles: ["USER"],
          authMethod: user.authMethod,
          avatarUrl: null,
        }}
      />
    );
  }

  return (
    <NyaScansApp
      view="dashboard"
      resourceSlug={slug?.[0]}
      operationPath={slug ?? []}
      actor={{
        displayName: actor.displayName,
        email: actor.email,
        role: actor.primaryRole,
        roles: actor.roles,
        authMethod: actor.authMethod,
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
