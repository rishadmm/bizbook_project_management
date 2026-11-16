"use client";
import dynamic from "next/dynamic";
import { useMemo } from "react";
import type { ClientMode } from "@/features/ops-map/types";
import type { InitialState } from "@/features/ops-map/components/OpsMapApp";
import { hydrateClientMap, type ClientMapPayload } from "../map-payload";

const App = dynamic(() => import("@/features/ops-map/components/OpsMapApp"), {
  ssr: false,
  loading: () => (
    <div className="fixed bottom-[56px] left-0 right-0 top-16 z-[40] flex items-center justify-center bg-slate-100 text-sm font-semibold text-slate-500 md:bottom-0 md:left-[248px]">
      <span className="mr-3 h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />Loading live map…
    </div>
  ),
});

/** Live Ops Map in client mode: loaded with a dynamic import (like the internal /map) and fed with the client-safe payload only. */
export default function ClientMapLoader({ payload, initial }: { payload: ClientMapPayload; initial: InitialState }) {
  const data = useMemo(() => hydrateClientMap(payload), [payload]);
  const mode = useMemo<ClientMode>(() => ({ base: payload.base, showSubs: payload.showSubs, showFinancials: payload.showFinancials }), [payload]);
  return <App data={data} initial={initial} clientMode={mode} />;
}
