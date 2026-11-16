// Client portal roles and slug rules. PURE (no node imports): safe in client components. Both roles are READ-ONLY; `admin` additionally sees the Team page.
export type ClientRole = "admin" | "viewer";
export const CLIENT_ROLES: { value: ClientRole; label: string; hint: string }[] = [
  { value: "admin", label: "Admin", hint: "Read-only access to everything, plus the list of colleagues (Team page)" },
  { value: "viewer", label: "Viewer", hint: "Read-only access to dashboards, map, reports and photos" },
];
export const clientRoleLabel = (r: string) => CLIENT_ROLES.find((x) => x.value === r)?.label ?? r;
export const isClientRole = (r: string): r is ClientRole => r === "admin" || r === "viewer";
export type ClientPerm = "view" | "team";
export const clientCan = (role: string, perm: ClientPerm): boolean => (perm === "view" ? isClientRole(role) : role === "admin");
export const DEMO_CLIENT_PASSWORD = "Portal@123";
