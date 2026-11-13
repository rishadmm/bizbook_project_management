import { requirePage } from "@/lib/auth";
import { lookups } from "@/features/admin/queries";
import { PageHeader } from "@/components/ui/PageHeader";
import { CardSection } from "@/components/ui/Card";
import { UserForm } from "@/features/admin/components/forms";

export default async function NewUserPage() {
  const me = await requirePage("users", "create");
  const { departments, roles, users } = lookups();
  return (
    <>
      <PageHeader title="New user" breadcrumbs={[{ label: "Users", href: "/admin/users" }, { label: "New" }]} />
      <CardSection>
        <UserForm mode="create" departments={departments.map((d) => ({ value: d.id, label: d.name }))}
          roles={roles.filter((r) => r.code !== "super_admin" || me.isSuperAdmin).map((r) => ({ value: r.id, label: r.name }))} users={users.map((u) => ({ value: u.id, label: u.name }))} />
      </CardSection>
    </>
  );
}
