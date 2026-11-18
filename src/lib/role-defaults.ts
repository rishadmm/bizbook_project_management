// Default system roles and their permission sets (AUTH_SPEC section E). Pure data.
import { MODULES, MODULE_KEYS, type ModuleKey } from "./permissions";

export interface SystemRole { code: string; name: string; description: string; perms: Partial<Record<ModuleKey, string[]>> }

const all = (m: ModuleKey) => [...MODULES[m].actions];
const view = (...ms: ModuleKey[]) => Object.fromEntries(ms.map((m) => [m, ["view"]])) as Partial<Record<ModuleKey, string[]>>;
const EVERYONE: Partial<Record<ModuleKey, string[]>> = view("dashboard", "approvals");

const everything = Object.fromEntries(MODULE_KEYS.map((m) => [m, all(m)])) as Partial<Record<ModuleKey, string[]>>;

export const SYSTEM_ROLES: SystemRole[] = [
  { code: "super_admin", name: "Super admin", description: "Full access to everything. Cannot be edited or deleted.", perms: {} },
  { code: "admin", name: "Administrator", description: "Administers users, settings and workflows.", perms: { ...everything, roles: ["view"] } },
  {
    code: "management", name: "Management", description: "Executive oversight and approvals.",
    perms: {
      ...view("dashboard", "lost_analysis", "projects", "ops_map", "project_map", "progress", "project_costs", "certificates", "clients", "approvals", "audit", "tender_budget"),
      tenders: ["view", "approve", "export"], tender_budget: ["view", "export"], subcontractors: ["view", "approve"], invoices: ["view", "approve"], procurement: ["view"],
    },
  },
  {
    code: "project_manager", name: "Project manager", description: "Runs projects, progress, subcontractors and certificates.",
    perms: {
      ...EVERYONE, ...view("tenders", "ops_map"), clients: ["view", "portal"],
      projects: ["view", "create", "edit"], project_map: ["view", "edit"], progress: ["view", "create", "verify"], project_costs: ["view", "create"],
      subcontractors: ["view", "create", "edit"], invoices: ["view"], certificates: ["view", "issue"], procurement: ["view", "create", "evaluate"],
    },
  },
  {
    code: "estimator", name: "Estimator", description: "Prepares tenders and budgets.",
    perms: {
      ...EVERYONE, ...view("projects", "ops_map"),
      tenders: ["view", "create", "edit", "submit", "export"], tender_budget: ["view", "edit", "edit_margin", "export"],
      lost_analysis: ["view", "edit"], clients: ["view", "create", "edit"],
    },
  },
  {
    code: "engineer", name: "Engineer", description: "Site engineering: progress and map.",
    perms: {
      ...EVERYONE, ...view("tenders", "tender_budget", "projects", "ops_map", "project_costs", "subcontractors", "certificates"),
      project_map: ["view", "edit"], progress: ["view", "create"], procurement: ["view", "evaluate"],
    },
  },
  {
    code: "finance", name: "Finance", description: "Invoices, certification, payment and costs.",
    perms: {
      ...EVERYONE, ...view("tenders", "tender_budget", "projects", "ops_map", "subcontractors", "certificates", "clients"),
      invoices: ["view", "certify", "approve", "pay"], project_costs: ["view", "create"], procurement: ["view", "evaluate", "export"],
    },
  },
  { code: "hr", name: "HR", description: "Human resources.", perms: { ...EVERYONE, ...view("projects", "ops_map", "users") } },
  {
    code: "procurement", name: "Procurement officer", description: "Supplier registration review, prequalification and supplier tendering (everything except the award approval).",
    perms: {
      ...EVERYONE, ...view("projects", "ops_map", "invoices", "clients"), subcontractors: ["view", "create", "edit", "approve", "portal", "setup"],
      procurement: all("procurement").filter((a) => a !== "award"),
    },
  },
  {
    code: "viewer", name: "Viewer", description: "Read-only access.",
    perms: { ...EVERYONE, ...view("tenders", "tender_budget", "lost_analysis", "projects", "ops_map", "project_map", "progress", "project_costs", "subcontractors", "invoices", "certificates", "clients", "procurement") },
  },
];

/** Map legacy users.role text to a system role code. */
export const LEGACY_ROLE_MAP: Record<string, string> = {
  admin: "admin", manager: "project_manager", engineer: "engineer", estimator: "estimator", finance: "finance", hr: "hr", viewer: "viewer",
};
