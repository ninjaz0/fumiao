function formatYamlScalar(value: unknown): string {
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  const str = String(value ?? "");
  if (
    !str ||
    str !== str.trim() ||
    str === "true" ||
    str === "false" ||
    /[:#\[\]\{\},"'\r\n]/.test(str)
  ) {
    return JSON.stringify(str);
  }
  return str;
}

export function serializeSkillMarkdown(skill: {
  name: string;
  slug: string;
  description?: string;
  frontmatter?: Record<string, unknown> | null;
  body_md: string;
}): string {
  const fm =
    skill.frontmatter &&
    typeof skill.frontmatter === "object" &&
    !Array.isArray(skill.frontmatter)
      ? skill.frontmatter
      : {};

  const rawName = fm.name !== undefined ? fm.name : skill.name;
  const rawSlug = fm.slug !== undefined ? fm.slug : skill.slug;
  const rawDescription =
    fm.description !== undefined
      ? fm.description
      : skill.description || undefined;

  const orderedEntries: [string, unknown][] = [
    ["name", rawName],
    ["slug", rawSlug],
    ...(rawDescription !== undefined
      ? ([["description", rawDescription]] as [string, unknown][])
      : []),
  ];

  for (const [key, val] of Object.entries(fm)) {
    if (key === "name" || key === "slug" || key === "description") continue;
    if (val === undefined) continue;
    orderedEntries.push([key, val]);
  }

  const lines: string[] = ["---"];
  for (const [key, val] of orderedEntries) {
    if (!/^[A-Za-z0-9_-]+$/.test(key)) continue;
    if (Array.isArray(val)) {
      if (val.length === 0) {
        lines.push(`${key}: []`);
      } else {
        lines.push(`${key}:`);
        for (const item of val) {
          lines.push(`  - ${formatYamlScalar(item)}`);
        }
      }
    } else if (val && typeof val === "object") {
      lines.push(`${key}: ${JSON.stringify(val)}`);
    } else {
      lines.push(`${key}: ${formatYamlScalar(val)}`);
    }
  }
  lines.push("---", "", skill.body_md);
  return lines.join("\n");
}
