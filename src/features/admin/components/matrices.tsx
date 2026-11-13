"use client";
import { useMemo, useState } from "react";
import { Check, Minus, X } from "lucide-react";
import { MODULES, MODULE_GROUPS, MODULE_KEYS, navFor, type ModuleKey, type PermissionMap } from "@/lib/permissions";
import { cn } from "@/components/ui/cn";
import { Button } from "@/components/ui/Button";
import { saveRoleAction, saveUserOverrides } from "@/features/admin/actions";

const ACTION_ORDER = ["view", "create", "edit", "edit_margin", "delete", "submit", "approve", "certify", "pay", "issue", "verify", "export", "disable", "reset_password"];
const ACTIONS = ACTION_ORDER.filter((a) => MODULE_KEYS.some((m) => (MODULES[m].actions as readonly string[]).includes(a)));
const has = (m: ModuleKey, a: string) => (MODULES[m].actions as readonly string[]).includes(a);
const pretty = (a: string) => a.replace(/_/g, " ");

function toPerms(keys: Iterable<string>): PermissionMap {
  const out: PermissionMap = {};
  for (const k of keys) { const [m, a] = k.split(":") as [ModuleKey, string]; (out[m] ??= []).push(a); }
  return out;
}

/** Role permission matrix editor (rows = modules grouped, columns = actions) + live sidebar preview. */
export function RoleMatrixEditor({ roleId, initial, readOnly, isSuperAdmin, name, description, isSystem, canEdit }: {
  roleId: number; initial: string[]; readOnly?: boolean; isSuperAdmin?: boolean; name: string; description: string | null; isSystem: boolean; canEdit: boolean;
}) {
  const [sel, setSel] = useState<Set<string>>(() => new Set(initial));
  const locked = readOnly || !canEdit;
  const toggle = (keys: string[], on: boolean) => setSel((p) => { const n = new Set(p); for (const k of keys) on ? n.add(k) : n.delete(k); return n; });
  const preview = useMemo(() => navFor(toPerms(sel), !!isSuperAdmin), [sel, isSuperAdmin]);
  return (
    <form action={saveRoleAction} className="grid gap-5 lg:grid-cols-[1fr_260px]">
      <input type="hidden" name="id" value={roleId} />
      {[...sel].map((k) => <input key={k} type="hidden" name="perm" value={k} />)}
      <div className="space-y-4">
        {!isSystem && !locked && (
          <div className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2">
            <label className="block text-xs font-medium text-slate-600">Name<input name="name" defaultValue={name} required className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal" /></label>
            <label className="block text-xs font-medium text-slate-600">Description<input name="description" defaultValue={description ?? ""} className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal" /></label>
          </div>
        )}
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm" data-testid="role-matrix">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">Module</th>
                {ACTIONS.map((a) => {
                  const keys = MODULE_KEYS.filter((m) => has(m, a)).map((m) => `${m}:${a}`);
                  const all = keys.every((k) => sel.has(k));
                  return (
                    <th key={a} className="px-1.5 py-2 text-center font-semibold">
                      <div className="whitespace-nowrap text-[10px]">{pretty(a)}</div>
                      <input type="checkbox" aria-label={`Select column ${a}`} disabled={locked} checked={all} onChange={(e) => toggle(keys, e.target.checked)} className="mt-1 h-3.5 w-3.5" />
                    </th>
                  );
                })}
                <th className="px-2 py-2 text-center font-semibold text-[10px]">All</th>
              </tr>
            </thead>
            <tbody>
              {MODULE_GROUPS.map((g) => {
                const mods = MODULE_KEYS.filter((m) => MODULES[m].group === g);
                if (!mods.length) return null;
                return [
                  <tr key={g} className="bg-slate-100/70"><td colSpan={ACTIONS.length + 2} className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{g}</td></tr>,
                  ...mods.map((m) => {
                    const rowKeys = MODULES[m].actions.map((a) => `${m}:${a}`);
                    return (
                      <tr key={m} className="border-t border-slate-100" data-module={m}>
                        <td className="px-3 py-1.5 font-medium text-slate-800">{MODULES[m].label}</td>
                        {ACTIONS.map((a) => (
                          <td key={a} className="px-1.5 py-1.5 text-center">
                            {has(m, a) ? <input type="checkbox" aria-label={`${m} ${a}`} data-perm={`${m}:${a}`} disabled={locked} checked={sel.has(`${m}:${a}`)} onChange={(e) => toggle([`${m}:${a}`], e.target.checked)} className="h-4 w-4" /> : null}
                          </td>
                        ))}
                        <td className="px-2 py-1.5 text-center"><input type="checkbox" aria-label={`Select row ${m}`} disabled={locked} checked={rowKeys.every((k) => sel.has(k))} onChange={(e) => toggle(rowKeys, e.target.checked)} className="h-3.5 w-3.5" /></td>
                      </tr>
                    );
                  }),
                ];
              })}
            </tbody>
          </table>
        </div>
        {!locked && <div className="flex items-center gap-3"><Button type="submit" variant="primary">Save permissions</Button><span className="text-xs text-slate-500">Changes apply to every user with this role at their next page load.</span></div>}
      </div>
      <aside className="h-fit rounded-lg border border-slate-200 bg-white p-4">
        <h3 className="mb-2 text-sm font-semibold text-slate-900">Menu preview</h3>
        <p className="mb-2 text-xs text-slate-500">Sidebar items this role will see.</p>
        <ul data-testid="menu-preview" className="space-y-1 text-sm">
          {preview.map((n) => <li key={n.href} className="flex items-center gap-2 text-slate-700"><Check size={13} className="text-emerald-600" />{n.label}{n.section === "admin" && <span className="text-[10px] uppercase text-slate-400">admin</span>}</li>)}
          {preview.length === 0 && <li className="text-slate-400">No menu items</li>}
        </ul>
      </aside>
    </form>
  );
}

type Cell = "inherit" | "allow" | "deny";
const NEXT: Record<Cell, Cell> = { inherit: "allow", allow: "deny", deny: "inherit" };

/** Per-user access matrix: effective permission with source and tri-state override toggles (inherit / allow / deny). */
export function AccessMatrix({ userId, roleKeys, initial, readOnly, isSuperAdmin }: { userId: number; roleKeys: string[]; initial: Record<string, "allow" | "deny">; readOnly: boolean; isSuperAdmin: boolean }) {
  const [ov, setOv] = useState<Record<string, Cell>>(() => ({ ...initial }));
  const roleSet = useMemo(() => new Set(roleKeys), [roleKeys]);
  const cycle = (k: string) => setOv((p) => { const n = { ...p }; const nx = NEXT[p[k] ?? "inherit"]; if (nx === "inherit") delete n[k]; else n[k] = nx; return n; });
  const payload: Record<string, string> = {};
  for (const [k, v] of Object.entries(ov)) if (v !== "inherit") payload[k] = v;
  return (
    <form action={saveUserOverrides} className="space-y-3">
      <input type="hidden" name="id" value={userId} />
      <input type="hidden" name="overrides" value={JSON.stringify(payload)} />
      <p className="text-xs text-slate-500">
        {isSuperAdmin ? "Super admin has every permission; overrides do not apply." : "Click a cell to cycle: inherit from role → allow → deny. Effective permission = role + allow − deny."}
      </p>
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm" data-testid="access-matrix">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr><th className="px-3 py-2 text-left font-semibold">Module</th>{ACTIONS.map((a) => <th key={a} className="px-1.5 py-2 text-center text-[10px] font-semibold whitespace-nowrap">{pretty(a)}</th>)}</tr>
          </thead>
          <tbody>
            {MODULE_GROUPS.map((g) => {
              const mods = MODULE_KEYS.filter((m) => MODULES[m].group === g);
              return [
                <tr key={g} className="bg-slate-100/70"><td colSpan={ACTIONS.length + 1} className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{g}</td></tr>,
                ...mods.map((m) => (
                  <tr key={m} className="border-t border-slate-100">
                    <td className="px-3 py-1.5 font-medium text-slate-800">{MODULES[m].label}</td>
                    {ACTIONS.map((a) => {
                      if (!has(m, a)) return <td key={a} />;
                      const k = `${m}:${a}`;
                      const o = ov[k] ?? "inherit";
                      const fromRole = roleSet.has(k);
                      const effective = isSuperAdmin || (o === "allow" ? true : o === "deny" ? false : fromRole);
                      const src = isSuperAdmin ? "super admin" : o === "allow" ? "allow override" : o === "deny" ? "deny override" : fromRole ? "role" : "none";
                      return (
                        <td key={a} className="px-1 py-1 text-center">
                          <button type="button" disabled={readOnly || isSuperAdmin} onClick={() => cycle(k)} title={`${src}`} data-cell={k} data-state={o}
                            className={cn("inline-flex h-7 w-9 items-center justify-center rounded border text-xs",
                              o === "allow" && "border-emerald-400 bg-emerald-50 text-emerald-700", o === "deny" && "border-red-400 bg-red-50 text-red-700",
                              o === "inherit" && (effective ? "border-slate-200 bg-white text-slate-600" : "border-transparent text-slate-300"))}>
                            {effective ? <Check size={14} /> : o === "deny" ? <X size={14} /> : <Minus size={14} />}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                )),
              ];
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500">
        <span className="inline-flex items-center gap-1"><span className="h-3 w-3 rounded border border-slate-300 bg-white" /> from role</span>
        <span className="inline-flex items-center gap-1"><span className="h-3 w-3 rounded border border-emerald-400 bg-emerald-50" /> allow override</span>
        <span className="inline-flex items-center gap-1"><span className="h-3 w-3 rounded border border-red-400 bg-red-50" /> deny override</span>
      </div>
      {!readOnly && !isSuperAdmin && <Button type="submit" variant="primary">Save access overrides</Button>}
    </form>
  );
}
