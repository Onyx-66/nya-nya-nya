import type { Metadata } from "next";
import type { CSSProperties } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import { getSiteTheme } from "@/lib/server/site-settings";
import { getSiteConfiguration } from "@/lib/server/site-configuration";
import {
  defaultSiteConfiguration,
  siteMediaUrl,
} from "@/lib/site-configuration";
import {
  siteThemeDataAttributes,
  siteThemeVariables,
} from "@/lib/site-theme";
import {
  cssVariableForToken,
  themeTokenKeys,
} from "@/lib/theme-system";
import { SystemNotificationProvider } from "@/components/nyascans/SystemNotifications";
import "./globals.css";
import "./admin.css";

const cachedThemeVariableNames = [
  ...themeTokenKeys.map(cssVariableForToken),
  "--theme-logo-color",
  "--theme-logo-accent-color",
  "--theme-logo-outline-color",
];
const cachedThemeIds = [
  "nya-midnight",
  "paper-daylight",
  "slate-rain",
  "dracula-bloom",
  "jade-night",
];
const themeBootstrapScript = `(()=>{try{const c=JSON.parse(localStorage.getItem("nyascans:user-theme-cache:v2")||"null");const v=c&&c.variables;const k=${JSON.stringify(cachedThemeVariableNames)};const i=${JSON.stringify(cachedThemeIds)};const a=typeof c?.activeThemeId==="string"&&(i.includes(c.activeThemeId)||/^custom:theme_[0-9a-f]{32}$/.test(c.activeThemeId));if(!c||c.schemaVersion!==2||!(c.type==="dark"||c.type==="light")||!a||!v||Object.keys(v).length!==k.length||!k.every(n=>Object.prototype.hasOwnProperty.call(v,n)&&/^#[0-9A-Fa-f]{6}$/.test(String(v[n]))))return;const r=document.documentElement;for(const n of k)r.style.setProperty(n,String(v[n]));r.dataset.theme=c.type;r.dataset.userTheme=c.activeThemeId;r.dataset.logoColorMode=v["--theme-logo-color"]===v["--theme-logo-accent-color"]?"fixed":"auto";r.style.colorScheme=c.type;const m=document.querySelector('meta[name="theme-color"]');if(m&&/^#[0-9A-Fa-f]{6}$/.test(String(c.background)))m.setAttribute("content",c.background)}catch{}})();`;

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const configuration = await getSiteConfiguration().catch(
    () => defaultSiteConfiguration,
  );
  const siteName = configuration.brand.siteName || "NyaScans";
  const description =
    configuration.brand.shortDescription ||
    "Discover original manga, manhwa, and manhua from independent publishing teams.";
  const appIcon =
    configuration.brand.appIcon.enabled
      ? siteMediaUrl("app", configuration.brand.appIcon)
      : null;
  return {
    metadataBase: new URL("https://nyascans.com"),
    title: {
      default: `${siteName} | Read beyond the panel`,
      template: `%s | ${siteName}`,
    },
    description,
    other: {
      "codex-preview": "development",
    },
    openGraph: {
      title: `${siteName} | Read beyond the panel`,
      description,
      url: "https://nyascans.com",
      siteName,
      type: "website",
      images: [
        {
          url: "/art/hero-onyx-archive.png",
          width: 1600,
          height: 1000,
          alt: "An archivist holds a luminous onyx shard above a rain-lit city.",
        },
      ],
    },
    robots: {
      index: true,
      follow: true,
    },
    icons: {
      icon: appIcon ?? "/favicon.svg",
      shortcut: appIcon ?? "/favicon.svg",
      apple: appIcon ?? undefined,
    },
  };
}

export const dynamic = "force-dynamic";

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const siteTheme = await getSiteTheme();
  return (
    <html
      lang="en"
      suppressHydrationWarning
      style={siteThemeVariables(siteTheme) as CSSProperties}
      {...siteThemeDataAttributes(siteTheme)}
    >
      <head>
        <meta name="theme-color" content={siteTheme.dark.background} />
        <script dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} />
        <link
          rel="preload"
          href="/art/hero-onyx-archive.png"
          as="image"
          type="image/png"
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <SystemNotificationProvider>{children}</SystemNotificationProvider>
      </body>
    </html>
  );
}
