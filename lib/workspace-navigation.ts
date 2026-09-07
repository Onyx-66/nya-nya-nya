type WorkspaceDestination = {
  label: string;
  slug: string;
  aliases: readonly string[];
  targetSection?: string;
  targetSubsection?: string;
};

const key = (value?: string) => (value ?? "").trim().toLowerCase().replaceAll(" ", "-");

/** Resolve sidebar clicks, bookmarks and browser history to the same feature. */
export function resolveWorkspaceLocation(
  items: readonly WorkspaceDestination[],
  section?: string,
  subsection?: string,
  fallback = "Dashboard",
) {
  let sectionKey = key(section);
  const aliases: Record<string, string> = {
    "create-new-serie": "add-series", "create-new-series": "add-series",
    "my-series-requests": "series-requests", "single-chapter": "single",
    "multi-chapter": "multi", "multi-chapters": "multi",
    "upload-history": "history", "upload-rules": "rules",
  };
  let subsectionKey = aliases[key(subsection)] ?? key(subsection);
  if (sectionKey === "create-new-serie") {
    sectionKey = "upload-center";
    subsectionKey = "add-series";
  }
  if (["chapters", "uploads", "upload-center"].includes(sectionKey)) {
    sectionKey = "upload-center";
    subsectionKey ||= "dashboard";
  } else if (sectionKey === "series" && subsectionKey === "new") {
    sectionKey = "upload-center";
    subsectionKey = "add-series";
  } else if (sectionKey === "rights") {
    sectionKey = "upload-center";
    subsectionKey = "rights";
  }
  const destination = items.find((item) =>
    Boolean(sectionKey) && key(item.targetSection) === sectionKey &&
    key(item.targetSubsection) === subsectionKey,
  ) ?? items.find((item) =>
    item.slug === sectionKey || key(item.label) === sectionKey ||
    item.aliases.some((alias) => key(alias) === sectionKey),
  );
  return {
    section: destination?.label ?? fallback,
    subsection: destination?.targetSubsection ?? subsectionKey,
  };
}
