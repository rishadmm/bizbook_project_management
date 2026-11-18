import type { Metadata } from "next";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: { default: "Become a supplier", template: "%s · Supplier portal" }, description: "Register your company, get prequalified and bid on tenders." };

export default function SuppliersLayout({ children }: { children: React.ReactNode }) { return children; }
