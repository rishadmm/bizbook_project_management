/** Client-side strong temporary password that satisfies the password policy (>= 8, upper, lower, digit). */
export function genTempPassword(): string {
  const U = "ABCDEFGHJKLMNPQRSTUVWXYZ", L = "abcdefghijkmnopqrstuvwxyz", D = "23456789";
  const buf = new Uint32Array(16);
  crypto.getRandomValues(buf);
  let i = 0;
  const pick = (chars: string) => chars[buf[i++ % buf.length] % chars.length];
  const c = [pick(U), pick(U), pick(L), pick(L), pick(L), pick(L), pick(D), pick(D), pick(L), pick(U)];
  for (let k = c.length - 1; k > 0; k--) { const j = buf[(i++) % buf.length] % (k + 1); [c[k], c[j]] = [c[j], c[k]]; }
  return `${c.join("")}-${pick(D)}${pick(D)}`;
}
