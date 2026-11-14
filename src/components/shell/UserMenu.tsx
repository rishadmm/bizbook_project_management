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
        className="flex items-center gap-2 rounded-full border border-line bg-white py-1 pl-1 pr-2.5 text-sm font-semibold text-slate-700 hover:bg-primary-50">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-xs font-extrabold text-white">{name.slice(0, 1).toUpperCase()}</span>
        <span className="hidden max-w-40 truncate sm:inline">{name}</span><ChevronDown size={14} className="text-slate-400" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-50 mt-1 w-60 rounded-2xl border border-line bg-white py-1.5 shadow-card">
          <div className="border-b border-slate-100 px-3 py-2">
            <div className="truncate text-sm font-bold text-dark">{name}</div>
            <div className="truncate text-xs text-slate-500">{role}</div>
            {email && <div className="truncate text-xs text-slate-400">{email}</div>}
          </div>
          <Link href="/account" role="menuitem" onClick={() => setOpen(false)} className="flex items-center gap-2 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-primary-50"><UserRound size={15} />My account</Link>
          <form action={logout}><button type="submit" role="menuitem" className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-semibold text-slate-700 hover:bg-primary-50"><LogOut size={15} />Sign out</button></form>
        </div>
      )}
    </div>
  );
}
