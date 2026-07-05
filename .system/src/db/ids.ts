export function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function createRunSlug(name: string, id: string) {
  const base = slugify(name) || "evidence-map-run";
  return `${base}-${id.replace(/^run_/, "").slice(0, 8)}`;
}

export function createId(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}
