import Link from "next/link";
import { Check } from "lucide-react";
import { WIZARD_STEPS } from "@/lib/registration";
import { cn } from "@/components/ui/cn";

/** Progress bar of the 8-step registration wizard. `hrefBase` makes the finished steps clickable (portal wizard); the public account step has none. */
export default function WizardProgress({ current, hrefBase, maxStep = current }: { current: number; hrefBase?: string; maxStep?: number }) {
  const pctDone = Math.round(((current - 1) / (WIZARD_STEPS.length - 1)) * 100);
  return (
    <div data-testid="wizard-progress" aria-label={`Step ${current} of ${WIZARD_STEPS.length}`}>
      <div className="mb-3 flex items-center justify-between text-xs font-bold text-slate-500"><span>Step {current} of {WIZARD_STEPS.length}: <span className="text-dark">{WIZARD_STEPS[current - 1].label}</span></span><span>{pctDone}%</span></div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.max(pctDone, 4)}%` }} /></div>
      <ol className="mt-3 hidden grid-cols-8 gap-1 text-[11px] font-bold md:grid">
        {WIZARD_STEPS.map((s) => {
          const done = s.n < current, on = s.n === current;
          const body = (<><span className={cn("mx-auto mb-1 flex h-6 w-6 items-center justify-center rounded-full text-[11px]", done ? "bg-primary text-white" : on ? "bg-primary-50 text-primary ring-2 ring-primary" : "bg-slate-100 text-slate-400")}>{done ? <Check size={13} /> : s.n}</span><span className={cn("block text-center leading-tight", on ? "text-primary" : done ? "text-slate-700" : "text-slate-400")}>{s.label}</span></>);
          return <li key={s.n}>{hrefBase && s.n >= 2 && s.n <= Math.max(maxStep, current) ? <Link href={`${hrefBase}?step=${s.n}`} className="block hover:opacity-80">{body}</Link> : <div>{body}</div>}</li>;
        })}
      </ol>
    </div>
  );
}
