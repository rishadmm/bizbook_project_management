import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import "./globals.css";
import "leaflet/dist/leaflet.css";
import "@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css";

const manrope = Manrope({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"], variable: "--font-manrope", display: "swap" });

export const metadata: Metadata = {
  title: { default: "BizBook Project", template: "%s · BizBook Project" },
  description: "Tender-to-project management — the Project module of BizBook ERP",
};

// Root layout is intentionally minimal: the app shell lives in app/(main)/layout.tsx so /portal/[token] can opt out.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={manrope.variable}>
      <body className="antialiased">{children}</body>
    </html>
  );
}
