// Default map centre ("lat,lng") from the `map_center` setting. Server layouts render <MapCenterInit/> (client) which publishes it on globalThis;
// the Leaflet components read it with getMapCenter(fallback) when they have no features to fit to. Pure and safe in client code.
export type LatLng = [number, number];

export function parseMapCenter(v: string | null | undefined): LatLng | null {
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(v ?? "");
  if (!m) return null;
  const lat = Number(m[1]), lng = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? [lat, lng] : null;
}

export function getMapCenter(fallback: LatLng): LatLng {
  return (globalThis as unknown as { __opsMapCenter?: LatLng }).__opsMapCenter ?? fallback;
}
