"use client";
/* eslint-disable @next/next/no-img-element */
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

export interface GalleryPhoto { id: number; caption: string; date: string; sub?: string }

/** Thumbnail grid with a lightbox (arrow keys / Esc). Files come from /api/files/:id, which only serves this client's verified photos. */
export default function PhotoGallery({ photos, compact }: { photos: GalleryPhoto[]; compact?: boolean }) {
  const [i, setI] = useState<number | null>(null);
  const close = useCallback(() => setI(null), []);
  const step = useCallback((d: number) => setI((c) => (c === null ? c : (c + d + photos.length) % photos.length)), [photos.length]);
  useEffect(() => {
    if (i === null) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") close(); else if (e.key === "ArrowRight") step(1); else if (e.key === "ArrowLeft") step(-1); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [i, close, step]);
  const cur = i === null ? null : photos[i];
  return (
    <>
      <ul className={compact ? "flex flex-wrap gap-2" : "grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"} data-testid="photo-grid">
        {photos.map((p, n) => (
          <li key={p.id}>
            <button type="button" onClick={() => setI(n)} className="group block w-full overflow-hidden rounded-xl border border-line bg-white text-left shadow-card focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40" aria-label={`Open photo: ${p.caption}`}>
              <img src={`/api/files/${p.id}`} alt={p.caption} loading="lazy" className={`${compact ? "h-16 w-24" : "h-36 w-full"} object-cover transition group-hover:scale-[1.02]`} />
              {!compact && <span className="block px-2.5 py-2"><span className="block truncate text-xs font-bold text-dark">{p.caption}</span><span className="block text-[11px] text-slate-500">{p.date}{p.sub ? ` · ${p.sub}` : ""}</span></span>}
            </button>
          </li>
        ))}
      </ul>
      {cur && (
        <div className="fixed inset-0 z-[4000] flex items-center justify-center bg-slate-950/85 p-4" role="dialog" aria-modal="true" aria-label="Photo viewer" onClick={close}>
          <button type="button" aria-label="Close" onClick={close} className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"><X size={20} /></button>
          {photos.length > 1 && <button type="button" aria-label="Previous photo" onClick={(e) => { e.stopPropagation(); step(-1); }} className="absolute left-3 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"><ChevronLeft size={24} /></button>}
          <figure className="flex max-h-full max-w-5xl flex-col items-center gap-2" onClick={(e) => e.stopPropagation()}>
            <img src={`/api/files/${cur.id}`} alt={cur.caption} className="max-h-[80vh] max-w-full rounded-lg bg-white object-contain shadow-2xl" />
            <figcaption className="text-center text-sm font-semibold text-white">{cur.caption}<span className="ml-2 text-xs font-normal text-slate-300">{cur.date}{cur.sub ? ` · ${cur.sub}` : ""} · {i! + 1} / {photos.length}</span></figcaption>
          </figure>
          {photos.length > 1 && <button type="button" aria-label="Next photo" onClick={(e) => { e.stopPropagation(); step(1); }} className="absolute right-3 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"><ChevronRight size={24} /></button>}
        </div>
      )}
    </>
  );
}
