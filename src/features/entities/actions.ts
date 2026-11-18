"use server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { ENTITY_COOKIE, logAuthEvent, requireUser } from "@/lib/auth";
import { getEntityByCode } from "@/lib/entities";

/** Which list page a detail path falls back to when the user switches to another country (a record of country A does not exist in country B). */
function sectionOf(path: string | undefined): string | null {
  const m = /^\/(tenders|projects|subcontractors|invoices|clients|lost-analysis)(\/|$)/.exec(path ?? "");
  return m && path !== `/${m[1]}` ? `/${m[1]}` : null;
}

/**
 * Top-bar country switcher. The cookie only stores the code; every request re-validates it against user_entities (lib/auth.ts), so a forged
 * cookie for a country the user cannot access falls back to their default country.
 */
export async function switchEntity(code: string, currentPath?: string): Promise<{ ok: true; href: string | null } | { ok: false; error: string }> {
  const user = await requireUser();
  const e = getEntityByCode(code);
  if (!e || !user.entityIds.includes(e.id)) return { ok: false, error: "You do not have access to that country." };
  const jar = await cookies();
  jar.set(ENTITY_COOKIE, e.code, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 365 * 86_400, secure: process.env.NODE_ENV === "production" && process.env.COOKIE_SECURE !== "0" });
  await logAuthEvent("entity_switched", { userId: user.id, email: user.email, detail: `Switched country to ${e.country} (${e.code}, ${e.currency})` });
  revalidatePath("/", "layout");
  return { ok: true, href: sectionOf(currentPath) };
}
