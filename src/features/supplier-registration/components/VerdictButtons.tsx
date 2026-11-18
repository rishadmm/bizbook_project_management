"use client";
import { Button } from "@/components/ui/Button";

/** Accept / Query / Clear buttons: the clicked verdict is written to a hidden field before the form submits (does not depend on submitter values). */
export default function VerdictButtons({ refKey, current }: { refKey: string; current?: string }) {
  const set = (v: string) => (e: React.MouseEvent<HTMLButtonElement>) => { (e.currentTarget.form!.elements.namedItem("verdict") as HTMLInputElement).value = v; };
  return (
    <>
      <input type="hidden" name="verdict" defaultValue="" />
      <Button type="submit" onClick={set("accepted")} size="sm" variant={current === "accepted" ? "success" : "secondary"} data-testid={`accept-${refKey}`}>Accept</Button>
      <Button type="submit" onClick={set("query")} size="sm" variant="danger" data-testid={`query-btn-${refKey}`}>Query</Button>
      {current && <Button type="submit" onClick={set("clear")} size="sm" variant="ghost">Clear</Button>}
    </>
  );
}
