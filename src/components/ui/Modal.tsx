"use client";
import { X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { buttonClass, type ButtonSize, type ButtonVariant } from "./Button";

/** Controlled modal. */
export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[2000] flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 pt-[8vh]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`w-full ${wide ? "max-w-3xl" : "max-w-lg"} rounded-xl bg-white shadow-xl`}>
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          <button type="button" onClick={onClose} className="rounded p-1 text-slate-500 hover:bg-slate-100" aria-label="Close"><X size={18} /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

/**
 * Button that opens a modal containing server-rendered `children` (typically a <form action={serverAction}>).
 * The modal closes automatically shortly after a contained form is submitted.
 */
export function ModalButton({ label, title, children, variant = "secondary", size = "md", wide, icon }: {
  label: string; title: string; children: ReactNode; variant?: ButtonVariant; size?: ButtonSize; wide?: boolean; icon?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={buttonClass(variant, size)} onClick={() => setOpen(true)}>{icon}{label}</button>
      <Modal open={open} onClose={() => setOpen(false)} title={title} wide={wide}>
        <div onSubmit={() => setTimeout(() => setOpen(false), 250)}>{children}</div>
      </Modal>
    </>
  );
}
