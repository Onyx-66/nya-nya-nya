import { getAuthenticatedUser, loginPath } from "@/app/chatgpt-auth";
import { NyaScansApp } from "@/components/nyascans/NyaScansApp";
import { getActor } from "@/lib/server/policy";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Upload Chapters",
  robots: { index: false, follow: false, noarchive: true },
};

type UploadPageProps = {
  params: Promise<{ mode?: string[] }>;
};

export default async function UploadChapterPage({
  params,
}: UploadPageProps) {
  const { mode } = await params;
  const requestedMode: string = [
    "dashboard",
    "add-series",
    "series-requests",
    "create-team",
    "series",
    "single",
    "multi",
    "drafts",
    "history",
    "review-status",
    "rights",
    "rules",
  ].includes(mode?.[0] ?? "")
    ? mode![0]!
    : "dashboard";
  const uploadMode =
    requestedMode === "single"
      ? ("SINGLE" as const)
      : requestedMode === "multi"
        ? ("BATCH" as const)
        : undefined;
  const identity = await getAuthenticatedUser();

  if (!identity) {
    return (
      <NyaScansApp
        view="access"
        actor={null}
        signInPath={loginPath(
          requestedMode
            ? `/upload-chapter/${requestedMode}`
            : "/upload-chapter",
        )}
      />
    );
  }

  let actor: Awaited<ReturnType<typeof getActor>> = null;
  try {
    actor = await getActor();
  } catch {
    actor = null;
  }

  if (!actor || !actor.canUseUploadCenter) {
    return (
      <NyaScansApp
        view="access"
        actor={{
          displayName: identity.displayName,
          email: identity.email,
          role: actor?.primaryRole ?? "USER",
          roles: actor?.roles ?? ["USER"],
          authMethod: identity.authMethod,
          avatarUrl: actor?.avatarUrl ?? null,
        }}
      />
    );
  }

  return (
    <NyaScansApp
      view="dashboard"
      resourceSlug="upload-center"
      operationPath={["upload-center", requestedMode]}
      uploadMode={uploadMode}
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
