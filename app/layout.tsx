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
import "./globals.css";

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
        {children}
      </body>
    </html>
  );
}
