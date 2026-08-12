import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { env } from "cloudflare:workers";
import {
  getAuthenticatedUser,
  safeAuthReturnPath,
} from "@/app/chatgpt-auth";
import { NyaScansApp, type AppView } from "@/components/nyascans/NyaScansApp";
import { ApiError } from "@/lib/server/api";
import { requirePaidEconomyPublicDocument } from "@/lib/server/commercial-settings";
import { getActor } from "@/lib/server/policy";
import { requireFeature } from "@/lib/server/feature-flags";
import {
  publicPaidChapterPredicate,
  publicPaidSeriesPredicate,
} from "@/lib/server/public-content-visibility";

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

async function publicRouteSeries(
  view: AppView,
  seriesSlug?: string,
  chapterSlug?: string,
) {
  if (!env.DB || !seriesSlug || !["title", "reader"].includes(view)) {
    return null;
  }
  const chapterJoin = view === "reader"
    ? `JOIN chapters c ON c.series_id = s.id
       LEFT JOIN content_visibility_overrides visibility_override
         ON visibility_override.chapter_id = c.id`
    : "";
  const chapterWhere = view === "reader"
    ? `AND c.slug = ?
       AND c.state = 'PUBLISHED'
       AND c.visibility = 'PUBLIC'
       AND c.published_at IS NOT NULL
       AND datetime(c.published_at) <= datetime('now')
       AND ${publicPaidChapterPredicate("c", "visibility_override")}`
    : "";
  return env.DB.prepare(
    `SELECT s.title, s.synopsis
       FROM series s
       ${chapterJoin}
      WHERE s.slug = ?
        AND s.is_published = 1
        AND s.archived_at IS NULL
        AND s.status NOT IN ('DRAFT', 'REJECTED', 'ARCHIVED')
        AND s.rights_status IN
          ('LICENSED', 'AUTHORIZED', 'DEMO_ORIGINAL', 'TEST_ORIGINAL')
        AND ${publicPaidSeriesPredicate("s")}
        ${chapterWhere}
      LIMIT 1`,
  )
    .bind(...(view === "reader" ? [seriesSlug, chapterSlug ?? ""] : [seriesSlug]))
    .first<{ title: string; synopsis: string }>();
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const { view, resourceSlug, chapterSlug } = resolveView(slug);
  if (view === "title" || view === "reader") {
    const title = await publicRouteSeries(view, resourceSlug, chapterSlug);
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
  if (
    ["title", "reader"].includes(resolved.view) &&
    !(await publicRouteSeries(
      resolved.view,
      resolved.resourceSlug,
      resolved.chapterSlug,
    ))
  ) {
    notFound();
  }
  if (resolved.view === "discounts") {
    try {
      await requirePaidEconomyPublicDocument();
      await requireFeature("payments");
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
