// Permission model (AUTH_SPEC section B). Pure constants + helpers: safe to import from client components.

export const MODULES = {
  dashboard: { label: "Dashboard", group: "General", actions: ["view"] },
  tenders: { label: "Tenders", group: "Sales / Tendering", actions: ["view", "create", "edit", "delete", "submit", "approve", "export"] },
  tender_budget: { label: "Tender budget", group: "Sales / Tendering", actions: ["view", "edit", "edit_margin", "export"] },
  lost_analysis: { label: "Loss analysis", group: "Sales / Tendering", actions: ["view", "edit"] },
  clients: { label: "Clients", group: "Sales / Tendering", actions: ["view", "create", "edit", "delete"] },
  projects: { label: "Projects", group: "Projects", actions: ["view", "create", "edit", "delete"] },
  project_map: { label: "Project map", group: "Projects", actions: ["view", "edit"] },
  progress: { label: "Progress reports", group: "Projects", actions: ["view", "create", "verify"] },
  project_costs: { label: "Project costs", group: "Projects", actions: ["view", "create"] },
  subcontractors: { label: "Subcontractors", group: "Subcontracting", actions: ["view", "create", "edit", "approve"] },
  invoices: { label: "Invoices", group: "Finance", actions: ["view", "certify", "approve", "pay"] },
  certificates: { label: "Completion certificates", group: "Finance", actions: ["view", "issue"] },
  approvals: { label: "Approvals inbox", group: "Administration", actions: ["view"] },
  approval_setup: { label: "Approval workflows", group: "Administration", actions: ["view", "edit"] },
  users: { label: "Users", group: "Administration", actions: ["view", "create", "edit", "disable", "reset_password"] },
  roles: { label: "Roles", group: "Administration", actions: ["view", "edit"] },
  settings: { label: "Settings", group: "Administration", actions: ["view", "edit"] },
  audit: { label: "Audit log", group: "Administration", actions: ["view"] },
} as const;

export type ModuleKey = keyof typeof MODULES;
export type ActionKey = string;
export type PermissionMap = Partial<Record<ModuleKey, ActionKey[]>>;

export const MODULE_KEYS = Object.keys(MODULES) as ModuleKey[];
export const MODULE_GROUPS = ["General", "Sales / Tendering", "Projects", "Subcontracting", "Finance", "Administration"] as const;

export function moduleActions(m: ModuleKey): readonly string[] { return MODULES[m].actions; }
export function isModule(m: string): m is ModuleKey { return m in MODULES; }
export function isValidPermission(m: string, a: string): boolean { return isModule(m) && (MODULES[m].actions as readonly string[]).includes(a); }

/** Sidebar entries. `module` view permission controls visibility. */
export interface NavItem { module: ModuleKey; href: string; label: string; section: "main" | "admin" }
export const NAV_ITEMS: NavItem[] = [
  { module: "dashboard", href: "/", label: "Dashboard", section: "main" },
  { module: "tenders", href: "/tenders", label: "Tenders", section: "main" },
  { module: "lost_analysis", href: "/lost-analysis", label: "Loss Analysis", section: "main" },
  { module: "projects", href: "/projects", label: "Projects", section: "main" },
  { module: "subcontractors", href: "/subcontractors", label: "Subcontractors", section: "main" },
  { module: "invoices", href: "/invoices", label: "Invoices", section: "main" },
  { module: "clients", href: "/clients", label: "Clients", section: "main" },
  { module: "approvals", href: "/approvals", label: "Approvals", section: "main" },
  { module: "users", href: "/admin/users", label: "Users", section: "admin" },
  { module: "roles", href: "/admin/roles", label: "Roles", section: "admin" },
  { module: "approval_setup", href: "/admin/approval-workflows", label: "Approval workflows", section: "admin" },
  { module: "audit", href: "/admin/audit", label: "Audit log", section: "admin" },
  { module: "settings", href: "/settings", label: "Settings", section: "admin" },
];

/** Pure permission check on a resolved permission map. */
export function hasPermission(perms: PermissionMap, isSuperAdmin: boolean, module: ModuleKey, action: string): boolean {
  if (isSuperAdmin) return true;
  return !!perms[module]?.includes(action);
}

/** Modules whose `view` is granted (drives the sidebar). */
export function visibleModules(perms: PermissionMap, isSuperAdmin: boolean): ModuleKey[] {
  return MODULE_KEYS.filter((m) => hasPermission(perms, isSuperAdmin, m, "view"));
}

/** Menu items for a permission set (used by sidebar and the role "menu preview"). */
export function navFor(perms: PermissionMap, isSuperAdmin: boolean): NavItem[] {
  return NAV_ITEMS.filter((n) => hasPermission(perms, isSuperAdmin, n.module, "view"));
}

/** Password policy: >= 8 chars, upper, lower, digit. Returns an error message or null. */
export function passwordPolicyError(pw: string): string | null {
  if (pw.length < 8) return "Password must be at least 8 characters.";
  if (!/[A-Z]/.test(pw)) return "Password must contain an uppercase letter.";
  if (!/[a-z]/.test(pw)) return "Password must contain a lowercase letter.";
  if (!/[0-9]/.test(pw)) return "Password must contain a digit.";
  return null;
}
