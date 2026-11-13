"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, LogOut, UserRound } from "lucide-react";
import { logout } from "@/features/auth/actions";

/** Top-bar user menu: name, role, My account, Sign out. */
export default function UserMenu({ name, role, email }: { name: string; role: string; email: string | null }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", h); document.addEventListener("keydown", k);
    return () => { document.removeEventListener("mousedown", h); document.removeEventListener("keydown", k); };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button type="button" data-testid="user-menu" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-xs font-semibold text-white">{name.slice(0, 1).toUpperCase()}</span>
        <span className="hidden max-w-40 truncate sm:inline">{name}</span><ChevronDown size={14} className="text-slate-400" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-50 mt-1 w-60 rounded-md border border-slate-200 bg-white py-1 shadow-lg">
          <div className="border-b border-slate-100 px-3 py-2">
            <div className="truncate text-sm font-medium text-slate-900">{name}</div>
            <div className="truncate text-xs text-slate-500">{role}</div>
            {email && <div className="truncate text-xs text-slate-400">{email}</div>}
          </div>
          <Link href="/account" role="menuitem" onClick={() => setOpen(false)} className="flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"><UserRound size={15} />My account</Link>
          <form action={logout}><button type="submit" role="menuitem" className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"><LogOut size={15} />Sign out</button></form>
        </div>
      )}
    </div>
  );
}
