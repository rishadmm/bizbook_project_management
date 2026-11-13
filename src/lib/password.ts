import bcrypt from "bcryptjs";
import crypto from "node:crypto";

export const hashPassword = (pw: string) => bcrypt.hashSync(pw, 10);
export const verifyPassword = (pw: string, hash: string | null | undefined) => (hash ? bcrypt.compareSync(pw, hash) : false);
// Used to equalise timing when the account does not exist.
const DUMMY = bcrypt.hashSync("not-a-real-password", 10);
export const burnPasswordCheck = (pw: string) => { bcrypt.compareSync(pw, DUMMY); };

/** Random temporary password that satisfies the policy (shown once to the admin). */
export function generateTempPassword(): string {
  const pick = (chars: string) => chars[crypto.randomInt(chars.length)];
  const U = "ABCDEFGHJKLMNPQRSTUVWXYZ", L = "abcdefghijkmnopqrstuvwxyz", D = "23456789";
  const chars = [pick(U), pick(U), pick(L), pick(L), pick(L), pick(L), pick(D), pick(D), pick(L), pick(U)];
  for (let i = chars.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
  return chars.join("") + "-" + pick(D) + pick(D);
}
