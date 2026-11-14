// Subcontractor portal roles, permission matrix and slug rules. PURE (no node imports): safe in client components.
export type PortalRole = "owner" | "manager" | "site" | "accounts" | "viewer";
export const PORTAL_ROLES: { value: PortalRole; label: string; hint: string }[] = [
  { value: "owner", label: "Owner", hint: "Everything, including managing the company's portal users" },
  { value: "manager", label: "Manager", hint: "Everything except user management" },
  { value: "site", label: "Site engineer", hint: "Projects, progress updates, issues; documents read-only" },
  { value: "accounts", label: "Accounts", hint: "Invoices, statements, certificates and company documents" },
  { value: "viewer", label: "Viewer", hint: "Read-only access" },
];
export const portalRoleLabel = (r: string) => PORTAL_ROLES.find((x) => x.value === r)?.label ?? r;

export type PortalPerm =
  | "dashboard" | "projects" | "progress" | "progress_submit" | "invoices" | "invoices_submit" | "certificates" | "certificates_request" | "payments"
  | "issues" | "issues_raise" | "documents" | "documents_upload" | "request_change" | "team";

const ALL: PortalPerm[] = ["dashboard", "projects", "progress", "progress_submit", "invoices", "invoices_submit", "certificates", "certificates_request", "payments",
  "issues", "issues_raise", "documents", "documents_upload", "request_change", "team"];
/** Simple role matrix (PORTAL_SPEC section 1). */
export const PORTAL_ROLE_PERMS: Record<PortalRole, PortalPerm[]> = {
  owner: ALL,
  manager: ALL.filter((p) => p !== "team"),
  site: ["dashboard", "projects", "progress", "progress_submit", "issues", "issues_raise", "documents"],
  accounts: ["dashboard", "projects", "invoices", "invoices_submit", "payments", "certificates", "documents", "documents_upload", "request_change"],
  viewer: ["dashboard", "projects", "progress", "invoices", "certificates", "payments", "issues", "documents"],
};
export const isPortalRole = (r: string): r is PortalRole => r in PORTAL_ROLE_PERMS;
export const portalCan = (role: string, perm: PortalPerm): boolean => isPortalRole(role) && PORTAL_ROLE_PERMS[role].includes(perm);

export const DEMO_PORTAL_PASSWORD = "Portal@123";

/* ------------------------------------------------------------------ slugs */
const STOP = new Set(["llc", "co", "the", "and", "ltd", "company", "l", "l.l.c", "fze", "fzc", "pjsc"]);
export function slugify(name: string): string {
  const words = name.toLowerCase().replace(/&/g, " ").split(/[^a-z0-9]+/).filter((w) => w && !STOP.has(w));
  const s = words.slice(0, 2).join("-") || "company";
  return s.length < 3 ? `${s}-co` : s.slice(0, 40);
}
export const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export function slugError(slug: string): string | null {
  if (slug.length < 3 || slug.length > 40) return "The portal address must be 3-40 characters.";
  if (!SLUG_RE.test(slug)) return "Use lowercase letters, digits and single hyphens only (e.g. gulf-trench).";
  return null;
}
/** Assignments a portal user may see: the company's assignments, narrowed by `assignment_scope` (JSON id list; null = all). Draft/terminated stay hidden. */
export function parseScope(raw: string | null | undefined): number[] | null {
  if (!raw) return null;
  try { const a = JSON.parse(raw); return Array.isArray(a) ? a.map(Number).filter((n) => Number.isInteger(n)) : null; } catch { return null; }
}
