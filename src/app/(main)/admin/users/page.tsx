import Link from "next/link";
import { can, parseDbDate, requirePage } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { listUsers, lookups } from "@/features/admin/queries";
import { PageHeader } from "@/components/ui/PageHeader";
import { CardSection } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button, LinkButton } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Field";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/Table";

type SP = { q?: string; role?: string; status?: string; department?: string };

export default async function UsersPage({ searchParams }: { searchParams: Promise<SP> }) {
  const me = await requirePage("users");
  const sp = await searchParams;
  const rows = listUsers(sp);
  const { departments, roles } = lookups();
  return (
    <>
      <PageHeader title="Users" description="Accounts, roles and access." actions={can(me, "users", "create") ? <LinkButton href="/admin/users/new" variant="primary">New user</LinkButton> : undefined} />
      <form className="mb-4 flex flex-wrap items-end gap-2">
        <Input name="q" placeholder="Search name or email…" defaultValue={sp.q} className="w-64" />
        <Select name="role" defaultValue={sp.role ?? ""} options={roles.map((r) => ({ value: r.id, label: r.name }))} placeholder="All roles" className="w-44" />
        <Select name="department" defaultValue={sp.department ?? ""} options={departments.map((d) => ({ value: d.id, label: d.name }))} placeholder="All departments" className="w-44" />
        <Select name="status" defaultValue={sp.status ?? ""} options={[{ value: "active", label: "Active" }, { value: "disabled", label: "Disabled" }, { value: "locked", label: "Locked" }]} placeholder="Any status" className="w-36" />
        <Button type="submit">Filter</Button>
        <Link href="/admin/users" className="px-2 py-2 text-sm text-slate-500 hover:underline">Reset</Link>
      </form>
      <CardSection flush>
        <Table>
          <THead><TR><TH>Name</TH><TH>Email</TH><TH>Department</TH><TH>Role</TH><TH>Countries</TH><TH>Status</TH><TH>Last login</TH></TR></THead>
          <TBody>
            {rows.map((u) => {
              const locked = u.status === "locked" && parseDbDate(u.locked_until) > Date.now();
              return (
                <TR key={u.id} data-user={u.email ?? u.id}>
                  <TD><Link href={`/admin/users/${u.id}`} className="font-medium text-blue-700 hover:underline">{u.name}</Link>{u.must_change_password ? <span className="ml-2 text-[10px] uppercase text-amber-600">must change pw</span> : null}</TD>
                  <TD>{u.email ?? "—"}</TD><TD>{u.department_name ?? "—"}</TD><TD>{u.role_name ?? u.role}</TD><TD className="whitespace-nowrap text-xs">{u.entities ?? "—"}</TD>
                  <TD>{u.status === "disabled" ? <Badge tone="slate">Disabled</Badge> : locked ? <Badge tone="red">Locked</Badge> : <Badge tone="emerald">Active</Badge>}</TD>
                  <TD>{u.last_login_at ? formatDateTime(u.last_login_at) : "Never"}</TD>
                </TR>
              );
            })}
            {rows.length === 0 && <TR><TD colSpan={7} className="py-6 text-center text-slate-400">No users match.</TD></TR>}
          </TBody>
        </Table>
      </CardSection>
    </>
  );
}
