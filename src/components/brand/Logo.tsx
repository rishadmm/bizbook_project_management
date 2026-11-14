import fs from "node:fs";
import path from "node:path";
import { cn } from "@/components/ui/cn";

/** BizBook mark drawn in code. If `public/brand/logo.png` exists (checked on the server) it replaces the drawn square. */
const hasLogoImage = () => { try { return fs.existsSync(path.join(process.cwd(), "public", "brand", "logo.png")); } catch { return false; } };

export default function Logo({ dark = false, size = 32, className, wordmark = true }: { dark?: boolean; size?: number; className?: string; wordmark?: boolean }) {
  const img = hasLogoImage();
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
        {img ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src="/brand/logo.png" alt="" className="h-full w-full rounded-lg bg-white object-contain" />
        ) : (
          <span aria-hidden className={cn("flex h-full w-full items-center justify-center rounded-lg font-extrabold leading-none tracking-tighter text-white", dark ? "bg-primary" : "bg-sidebar")}
            style={{ fontSize: Math.round(size * 0.44) }}>BB</span>
        )}
      </span>
      {wordmark && (
        <span className={cn("text-[17px] font-extrabold leading-none tracking-tight", dark ? "text-white" : "text-dark")}>
          BizBook <span className={dark ? "text-[#a5a0ff]" : "text-primary"}>Project</span>
        </span>
      )}
    </span>
  );
}
