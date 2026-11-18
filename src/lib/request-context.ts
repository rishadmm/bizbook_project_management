// Request-scoped context (React cache = one object per server request): the currency that formatMoney() defaults to.
// There is NO module-global server state: two users on different countries rendering at the same time each see their own currency.
// Order inside a request: getSession() primes it with the viewer's active country; a detail page of another country's record then overrides it
// (assertRecordAccess in lib/entity-context.ts); portals prime it from the subcontractor's / client's country.
import { cache } from "react";
import { registerCurrencyResolver } from "./format";

const ctx = cache(() => ({ currency: undefined as string | undefined }));

export function setRequestCurrency(code: string): void { ctx().currency = code; }
registerCurrencyResolver(() => ctx().currency);

