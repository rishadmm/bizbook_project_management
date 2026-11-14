"use client";
import dynamic from "next/dynamic";
import type { OpsMapData } from "../types";
import type { InitialState } from "./OpsMapApp";

const App = dynamic(() => import("./OpsMapApp"), {
  ssr: false,
  loading: () => (
    <div className="fixed bottom-0 left-0 right-0 top-16 z-[40] flex items-center justify-center bg-slate-100 text-sm font-semibold text-slate-500 md:left-[248px]">
      <span className="mr-3 h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />Loading Live Ops Map…
    </div>
  ),
});

export default function OpsMapLoader({ data, initial }: { data: OpsMapData; initial: InitialState }) {
  return <App data={data} initial={initial} />;
}
