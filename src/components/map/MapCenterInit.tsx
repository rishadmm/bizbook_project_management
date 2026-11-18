"use client";
import { parseMapCenter } from "./map-center";

/** Publishes the `map_center` setting for the map components (they only mount on the client, after this has rendered). */
export default function MapCenterInit({ value }: { value: string }) {
  const c = parseMapCenter(value);
  (globalThis as unknown as { __opsMapCenter?: [number, number] }).__opsMapCenter = c ?? undefined;
  return null;
}
