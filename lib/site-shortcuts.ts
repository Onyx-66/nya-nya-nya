export const SITE_SHORTCUTS = [
  {
    keys: ["Ctrl / ⌘", "K"],
    label: "Search the catalog",
    href: null,
  },
  { keys: ["G", "H"], label: "Go to Home", href: "/" },
  { keys: ["G", "U"], label: "Go to Latest Updates", href: "/latest" },
  { keys: ["G", "B"], label: "Go to Browse", href: "/browse" },
  { keys: ["G", "L"], label: "Go to Library", href: "/library" },
  { keys: ["G", "S"], label: "Go to Store", href: "/store" },
  { keys: ["G", "R"], label: "Go to Roulette", href: "/roulette" },
  { keys: ["G", "N"], label: "Go to Notifications", href: "/notifications" },
  { keys: ["G", "A"], label: "Go to Account", href: "/account" },
  { keys: ["?"], label: "Open this shortcut guide", href: null },
] as const;

export const SITE_NAVIGATION_CHORDS = Object.freeze({
  h: "/",
  u: "/latest",
  b: "/browse",
  l: "/library",
  s: "/store",
  r: "/roulette",
  n: "/notifications",
  a: "/account",
});
