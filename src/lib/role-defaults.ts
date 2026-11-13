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
      ...view("dashboard", "lost_analysis", "projects", "project_map", "progress", "project_costs", "certificates", "clients", "approvals", "audit", "tender_budget"),
      tenders: ["view", "approve", "export"], tender_budget: ["view", "export"], subcontractors: ["view", "approve"], invoices: ["view", "approve"],
    },
  },
  {
    code: "project_manager", name: "Project manager", description: "Runs projects, progress, subcontractors and certificates.",
    perms: {
      ...EVERYONE, ...view("tenders", "clients"),
      projects: ["view", "create", "edit"], project_map: ["view", "edit"], progress: ["view", "create", "verify"], project_costs: ["view", "create"],
      subcontractors: ["view", "create", "edit"], invoices: ["view"], certificates: ["view", "issue"],
    },
  },
  {
    code: "estimator", name: "Estimator", description: "Prepares tenders and budgets.",
    perms: {
      ...EVERYONE, ...view("projects"),
      tenders: ["view", "create", "edit", "submit", "export"], tender_budget: ["view", "edit", "edit_margin", "export"],
      lost_analysis: ["view", "edit"], clients: ["view", "create", "edit"],
    },
  },
  {
    code: "engineer", name: "Engineer", description: "Site engineering: progress and map.",
    perms: {
      ...EVERYONE, ...view("tenders", "tender_budget", "projects", "project_costs", "subcontractors", "certificates"),
      project_map: ["view", "edit"], progress: ["view", "create"],
    },
  },
  {
    code: "finance", name: "Finance", description: "Invoices, certification, payment and costs.",
    perms: {
      ...EVERYONE, ...view("tenders", "tender_budget", "projects", "subcontractors", "certificates", "clients"),
      invoices: ["view", "certify", "approve", "pay"], project_costs: ["view", "create"],
    },
  },
  { code: "hr", name: "HR", description: "Human resources.", perms: { ...EVERYONE, ...view("projects", "users") } },
  {
    code: "procurement", name: "Procurement", description: "Subcontractor onboarding and procurement.",
    perms: { ...EVERYONE, ...view("projects", "invoices", "clients"), subcontractors: ["view", "create", "edit", "approve"] },
  },
  {
    code: "viewer", name: "Viewer", description: "Read-only access.",
    perms: { ...EVERYONE, ...view("tenders", "tender_budget", "lost_analysis", "projects", "project_map", "progress", "project_costs", "subcontractors", "invoices", "certificates", "clients") },
  },
];

/** Map legacy users.role text to a system role code. */
export const LEGACY_ROLE_MAP: Record<string, string> = {
  admin: "admin", manager: "project_manager", engineer: "engineer", estimator: "estimator", finance: "finance", hr: "hr", viewer: "viewer",
};
