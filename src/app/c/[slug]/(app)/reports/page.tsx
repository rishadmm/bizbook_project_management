import Link from "next/link";
import { AlertTriangle, CalendarRange, CalendarDays, FileBarChart } from "lucide-react";
import { PageHeader } from "@/components/ui";
import { requireClientUser } from "@/lib/client-portal-auth";

export const metadata = { title: "Reports" };

const REPORTS = [
  { key: "progress", icon: FileBarChart, title: "Project progress report", text: "Summary, health, stage table, S-curve and photos of the period, for one project or all, as of any date." },
  { key: "schedule", icon: CalendarRange, title: "Schedule & forecast report", text: "Planned vs projected finish per stage, with the slip in days." },
  { key: "issues", icon: AlertTriangle, title: "Issues & delays report", text: "Issues filtered by status, responsibility and date, with their impact on the programme." },
  { key: "monthly", icon: CalendarDays, title: "Monthly progress summary", text: "Quantities done, progress gained, crew size and key photos for a month." },
];

export default async function ClientReports({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  await requireClientUser(slug);
  return (
    <>
      <PageHeader title="Reports" description="Printable reports (Print / save as PDF) and CSV exports. They only contain progress verified by the project team." />
      <div className="grid gap-4 md:grid-cols-2" data-testid="report-hub">
        {REPORTS.map(({ key, icon: Icon, title, text }) => (
          <Link key={key} href={`/c/${slug}/reports/${key}`} className="flex items-start gap-4 rounded-2xl border border-line bg-white p-5 shadow-card transition hover:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary"><Icon size={22} /></span>
            <span><span className="block text-[15px] font-extrabold text-dark">{title}</span><span className="mt-1 block text-sm text-slate-500">{text}</span></span>
          </Link>
        ))}
      </div>
    </>
  );
}
