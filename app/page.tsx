import { getAuthenticatedUser } from "@/app/chatgpt-auth";
import { NyaScansApp } from "@/components/nyascans/NyaScansApp";
import { getActor } from "@/lib/server/policy";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getAuthenticatedUser();
  let actor: Awaited<ReturnType<typeof getActor>> = null;
  if (user) {
    try {
      actor = await getActor();
    } catch {
      actor = null;
    }
  }
  return (
    <NyaScansApp
      view="home"
      actor={
        user
          ? {
              displayName: user.displayName,
              email: user.email,
              role: actor?.primaryRole ?? "USER",
              roles: actor?.roles ?? ["USER"],
              authMethod: user.authMethod,
              avatarUrl: actor?.avatarUrl ?? null,
              canUseUploadCenter: actor?.canUseUploadCenter ?? false,
              canUpload: Boolean(
                actor &&
                  (["OWNER", "ADMINISTRATOR"].includes(actor.primaryRole) ||
                    actor.uploadTeamIds.length > 0),
              ),
              canRequestSeries: Boolean(
                actor &&
                  (["OWNER", "ADMINISTRATOR"].includes(actor.primaryRole) ||
                    actor.requestTeamIds.length > 0),
              ),
              canManageTeam: Boolean(
                actor &&
                  (["OWNER", "ADMINISTRATOR"].includes(actor.primaryRole) ||
                    actor.managedTeamIds.length > 0),
              ),
            }
          : null
      }
    />
  );
}
