import type { Metadata } from "next";
import "./globals.css";
import "leaflet/dist/leaflet.css";
import "@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css";

export const metadata: Metadata = { title: "Operations Module", description: "Tender-to-project management" };

// Root layout is intentionally minimal: the app shell lives in app/(main)/layout.tsx so /portal/[token] can opt out.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
