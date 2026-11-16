import type { Metadata } from "next";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: { default: "Client Portal", template: "%s · Client Portal" }, robots: { index: false, follow: false } };

export default function ClientPortalRootLayout({ children }: { children: React.ReactNode }) { return children; }
