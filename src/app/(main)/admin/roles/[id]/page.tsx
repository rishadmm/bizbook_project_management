import Link from "next/link";
import { notFound } from "next/navigation";
import { can, requirePage } from "@/lib/auth";
import { ALL_PERMISSION_KEYS, getRole, rolePermissionKeys, roleUsers } from "@/features/admin/queries";
import { PageHeader } from "@/components/ui/PageHeader";
import { CardSection } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { RoleMatrixEditor } from "@/features/admin/components/matrices";

export default async function RoleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requirePage("roles");
  const { id: raw } = await params;
  const id = Number(raw);
  const role = Number.isInteger(id) ? getRole(id) : undefined;
  if (!role) notFound();
  const isSuper = role.code === "super_admin";
  const users = roleUsers(role.id);
  return (
    <>
      <PageHeader title={role.name} description={role.description ?? undefined} breadcrumbs={[{ label: "Roles", href: "/admin/roles" }, { label: role.name }]}
        badges={<>{role.is_system ? <Badge tone="blue">System</Badge> : <Badge>Custom</Badge>}{isSuper && <Badge tone="violet">Bypasses all checks</Badge>}</>} />
      {isSuper && <p className="mb-4 rounded-md bg-violet-50 px-3 py-2 text-sm text-violet-800">The super admin role has every permission and cannot be edited or deleted.</p>}
      <RoleMatrixEditor roleId={role.id} initial={isSuper ? ALL_PERMISSION_KEYS : rolePermissionKeys(role.id)} readOnly={isSuper} isSuperAdmin={isSuper}
        name={role.name} description={role.description} isSystem={!!role.is_system} canEdit={can(me, "roles", "edit")} />
      <CardSection title={`Users with this role (${users.length})`} className="mt-5">
        {users.length ? <ul className="flex flex-wrap gap-2 text-sm">{users.map((u) => <li key={u.id}><Link className="text-blue-700 hover:underline" href={`/admin/users/${u.id}`}>{u.name}</Link></li>)}</ul> : <p className="text-sm text-slate-400">No users assigned.</p>}
      </CardSection>
    </>
  );
}
