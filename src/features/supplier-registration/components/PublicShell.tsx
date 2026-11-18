import Link from "next/link";
import Logo from "@/components/brand/Logo";
import { getSetting } from "@/lib/db";

/** Header + footer of the public supplier pages (/suppliers/**): BizBook look, same brand as the sign-in screens; works from 390 px up. */
export default function PublicShell({ children, active }: { children: React.ReactNode; active?: "home" | "register" | "login" }) {
  const company = getSetting("company_name", "Al Noor Infrastructure LLC");
  const link = (href: string, label: string, on: boolean) => (
    <Link href={href} className={`rounded-full px-3 py-1.5 text-sm font-bold ${on ? "bg-primary-50 text-primary" : "text-slate-600 hover:bg-slate-100"}`}>{label}</Link>
  );
  return (
    <div className="flex min-h-screen flex-col bg-white">
      <header className="sticky top-0 z-40 border-b border-line bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-[1100px] items-center gap-3 px-4 sm:px-6">
          <Link href="/suppliers" aria-label="Supplier home"><Logo size={30} wordmark={false} /></Link>
          <Link href="/suppliers" className="min-w-0 truncate text-[15px] font-extrabold tracking-tight text-dark"><span className="hidden sm:inline">{company} · </span>Supplier portal</Link>
          <nav className="ml-auto flex items-center gap-1" aria-label="Supplier">
            {link("/suppliers/login", "Sign in", active === "login")}
            <Link href="/suppliers/register" className="rounded-[10px] bg-primary px-3.5 py-2 text-sm font-bold text-white shadow-brand-sm hover:bg-primary-dark">Register<span className="hidden sm:inline"> your company</span></Link>
          </nav>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t border-line bg-[#f8fafc]">
        <div className="mx-auto flex w-full max-w-[1100px] flex-wrap items-center justify-between gap-2 px-4 py-5 text-xs text-muted sm:px-6">
          <span>© 2026 {company} · Powered by BizBook ERP</span>
          <span className="flex gap-4"><Link href="/suppliers" className="hover:text-primary">Become a supplier</Link><Link href="/suppliers/login" className="hover:text-primary">Supplier sign in</Link></span>
        </div>
      </footer>
    </div>
  );
}
