import { getChatGPTUser, loginPath } from "@/app/chatgpt-auth";
import { NyaScansApp } from "@/components/nyascans/NyaScansApp";
import { writeAudit } from "@/lib/server/admin-utils";
import { getActor } from "@/lib/server/policy";
import { randomId } from "@/lib/server/random-id";
import { forbidden } from "next/navigation";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Administrator Access",
  robots: { index: false, follow: false, noarchive: true },
};

type AdminPageProps = {
  params: Promise<{ slug?: string[] }>;
};

export default async function AdminPage({ params }: AdminPageProps) {
  const { slug } = await params;
  const identity = await getChatGPTUser();
  if (!identity) {
    return (
      <NyaScansApp
        view="access"
        actor={null}
        adminGate
        signInPath={loginPath("/onyx/admin/access")}
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
        adminGate
        actor={{
          displayName: identity.displayName,
          email: identity.email,
          role: "USER",
          roles: ["USER"],
          avatarUrl: null,
        }}
      />
    );
  }
  if (slug?.[0] === "audit-log" && !actor.roles.includes("OWNER")) {
    await writeAudit(actor, randomId(), {
      action: "audit.access.denied",
      category: "AUTHENTICATION_SECURITY",
      sourceArea: "ADMIN_PAGE",
      targetType: "AUDIT_LOG",
      targetId: "audit-log",
      result: "DENIED",
      reason: "Highest administrative role required.",
    }).catch(() => undefined);
    forbidden();
  }
  const fullAdministrator = actor.roles.some((role) =>
    ["OWNER", "ADMINISTRATOR"].includes(role),
  );
  const manager = actor.roles.includes("MANAGER");
  const managerSections = new Set([
    "new-series-queue",
    "support-tickets",
    "access-decisions",
  ]);
  if (
    !fullAdministrator &&
    (!manager || (slug?.[0] && !managerSections.has(slug[0])))
  ) {
    forbidden();
  }

  return (
    <NyaScansApp
      view="admin"
      resourceSlug={slug?.[0]}
      operationPath={slug ?? []}
      actor={{
        displayName: actor.displayName,
        email: actor.email,
        role: actor.primaryRole,
        roles: actor.roles,
        avatarUrl: actor.avatarUrl,
        canUseUploadCenter: true,
        canUpload: fullAdministrator,
        canRequestSeries: fullAdministrator,
        canManageTeam: fullAdministrator,
      }}
    />
  );
}
