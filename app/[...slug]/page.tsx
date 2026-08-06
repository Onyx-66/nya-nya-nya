import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  getAuthenticatedUser,
  safeAuthReturnPath,
} from "@/app/chatgpt-auth";
import { NyaScansApp, type AppView } from "@/components/nyascans/NyaScansApp";
import { findSeries } from "@/lib/catalog";
import { ApiError } from "@/lib/server/api";
import { requirePaidEconomyPublicDocument } from "@/lib/server/commercial-settings";
import { getActor } from "@/lib/server/policy";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ slug: string[] }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function resolveView(slug: string[]): {
  view: AppView;
  resourceSlug?: string;
  chapterSlug?: string;
} {
  const [root, second, third] = slug;
  if (root === "title" && third === "chapter") {
    return { view: "reader", resourceSlug: second, chapterSlug: slug[3] };
  }
  if (root === "title") return { view: "title", resourceSlug: second };
  if (root === "browse" || root === "search") return { view: "browse" };
  if (root === "library") return { view: "library" };
  if (root === "u" && second) {
    return { view: "profile", resourceSlug: second };
  }
  if (root === "store") {
    return { view: "store", resourceSlug: second ?? "coins" };
  }
  if (root === "checkout") return { view: "store", resourceSlug: "coins" };
  if (root === "account") return { view: "account" };
  if (root === "login") return { view: "login" };
  if (root === "signup" || root === "register") return { view: "signup" };
  if (root === "wallet") return { view: "wallet" };
  if (root === "orders") return { view: "orders" };
  if (root === "roulette") return { view: "roulette" };
  if (root === "notifications") return { view: "notifications" };
  if (root === "latest") return { view: "latest" };
  if (root === "pinned-series") return { view: "pinned" };
  if (root === "discounts") return { view: "discounts" };
  if (root === "rankings" || root === "leaderboard") {
    return { view: "rankings" };
  }
  if (root === "team") return { view: "team", resourceSlug: second };
  if (root === "teams") return { view: "teams" };
  if (root === "status") return { view: "status" };
  if (root === "support" || root === "report") return { view: "support" };
  if (root === "legal") return { view: "legal", resourceSlug: second };
  if (root === "collections" || root === "creator") {
    return { view: "generic", resourceSlug: second };
  }
  if (root === "errors") return { view: "error", resourceSlug: second };
  return { view: "generic", resourceSlug: root };
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const { view, resourceSlug } = resolveView(slug);
  if (view === "title" || view === "reader") {
    const title = findSeries(resourceSlug ?? "");
    if (!title) {
      return {
        title: "Series not found",
        description: "This series is not available in the NyaScans catalogue.",
        robots: { index: false, follow: false },
      };
    }
    return {
      title: view === "reader" ? `Read ${title.title}` : title.title,
      description: title.synopsis,
      robots: view === "reader" ? { index: false, follow: false } : undefined,
    };
  }
  const labels: Partial<Record<AppView, string>> = {
    browse: "Browse",
    library: "Library",
    store: "Store",
    account: "Account",
    profile: "Reader Profile",
    login: "Sign In",
    signup: "Create Account",
    wallet: "Wallet",
    orders: "Orders",
    notifications: "Notifications",
    latest: "Latest Updates",
    pinned: "Pinned Series",
    discounts: "Discounts",
    rankings: "Users Ranking",
    teams: "Publishing Teams",
    roulette: "Daily Roulette",
    status: "System Status",
    support: "Support",
    legal: "Legal",
  };
  return {
    title: labels[view] ?? "Explore",
    robots:
      [
        "account",
        "login",
        "signup",
        "wallet",
        "orders",
        "notifications",
        "roulette",
      ].includes(view)
        ? { index: false, follow: false }
        : undefined,
  };
}

export default async function CatchAllPage({
  params,
  searchParams,
}: PageProps) {
  const { slug } = await params;
  const query = (await searchParams) ?? {};
  const resolved = resolveView(slug);
  if (resolved.view === "discounts") {
    try {
      await requirePaidEconomyPublicDocument();
    } catch {
      notFound();
    }
  }
  const user = await getAuthenticatedUser();
  let actor: Awaited<ReturnType<typeof getActor>> = null;
  let accountBlocked = false;
  if (user) {
    try {
      actor = await getActor();
    } catch (error) {
      accountBlocked =
        error instanceof ApiError && error.code === "ACCOUNT_SUSPENDED";
      actor = null;
    }
  }
  const requestedReturnTo = Array.isArray(query.returnTo)
    ? query.returnTo[0]
    : query.returnTo;
  const authReturnTo = safeAuthReturnPath(requestedReturnTo ?? "/account");
  return (
    <NyaScansApp
      {...resolved}
      path={`/${slug.join("/")}`}
      authReturnTo={authReturnTo}
      accountBlocked={accountBlocked}
      authenticatedIdentity={
        user
          ? {
              displayName: user.displayName,
              email: user.email,
              authMethod: user.authMethod,
            }
          : null
      }
      actor={
        user && actor
          ? {
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
            }
          : null
      }
    />
  );
}
