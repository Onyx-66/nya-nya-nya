import { getAuthenticatedUser, loginPath } from "@/app/chatgpt-auth";
import { NyaScansApp } from "@/components/nyascans/NyaScansApp";
import { AdminPasskeyGate } from "@/components/nyascans/admin/AdminPasskeyGate";
import { writeAudit } from "@/lib/server/admin-utils";
import { actorHasCapability, getActor } from "@/lib/server/policy";
import { randomId } from "@/lib/server/random-id";
import { getFeatureStates } from "@/lib/server/feature-flags";
import {
  ADMIN_PERMISSION_REGISTRY,
  ADMIN_SECTION_ALTERNATE_CAPABILITIES,
  ADMIN_SECTION_CAPABILITIES,
} from "@/lib/admin-permissions";
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
  const identity = await getAuthenticatedUser();
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
          authMethod: identity.authMethod,
          avatarUrl: null,
        }}
      />
    );
  }
  if (!actorHasCapability(actor, "admin.console.access")) {
    forbidden();
  }

  if (actor.adminPasskeyRequired && !actor.adminPasskeyEnrolled) {
    return <AdminPasskeyGate displayName={actor.displayName} email={actor.email} />;
  }

  const requestedSection = slug?.[0] ?? "analytics";
  const requestedCapability = ADMIN_SECTION_CAPABILITIES[requestedSection];
  const hasRequestedCapability = requestedCapability
    ? actorHasCapability(actor, requestedCapability) ||
      (ADMIN_SECTION_ALTERNATE_CAPABILITIES[requestedSection] ?? []).some(
        (capability) => actorHasCapability(actor, capability),
      )
    : false;
  if (!requestedCapability || !hasRequestedCapability) {
    await writeAudit(actor, randomId(), {
      action: "admin.section.access.denied",
      category: "AUTHENTICATION_SECURITY",
      sourceArea: "ADMIN_PAGE",
      targetType: "ADMIN_SECTION",
      targetId: requestedSection,
      result: "DENIED",
      reason: "The active role does not grant this administrative capability.",
    }).catch(() => undefined);
    forbidden();
  }
  const featureStates = await getFeatureStates().catch(() => null);
  const premiumUnlocks = featureStates?.premium_unlocks.effective === true;
  const paymentsActive = featureStates?.payments.effective === true;
  const capabilities = ADMIN_PERMISSION_REGISTRY
    .map(([capability]) => capability)
    .filter((capability) => actorHasCapability(actor, capability));

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
        authMethod: actor.authMethod,
        avatarUrl: actor.avatarUrl,
        capabilities,
        adminFeatures: {
          premiumUnlocks,
          payments: paymentsActive,
          memberships: featureStates?.memberships.effective === true,
          adSupportedUnlocks:
            featureStates?.ad_supported_unlocks.effective === true,
          teamPayouts: featureStates?.team_payouts.effective === true,
        },
        canUseUploadCenter: true,
        canUpload: actorHasCapability(actor, "upload.create"),
        canRequestSeries: actorHasCapability(actor, "series.create"),
        canManageTeam: actorHasCapability(actor, "content.teams.manage"),
      }}
    />
  );
}
