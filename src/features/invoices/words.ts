import { currencyDecimals } from "@/lib/format";

// Amount in words ("AED One Hundred Twenty-Three Thousand Four Hundred Fifty-Six and 50/100 Only").
const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function below1000(n: number): string {
  const parts: string[] = [];
  if (n >= 100) { parts.push(`${ONES[Math.floor(n / 100)]} Hundred`); n %= 100; }
  if (n >= 20) { parts.push(TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : "")); }
  else if (n > 0) parts.push(ONES[n]);
  return parts.join(" ");
}
export function integerInWords(n: number): string {
  if (n === 0) return "Zero";
  const scales: [number, string][] = [[1e9, "Billion"], [1e6, "Million"], [1e3, "Thousand"]];
  const parts: string[] = [];
  for (const [v, name] of scales) { if (n >= v) { parts.push(`${below1000(Math.floor(n / v))} ${name}`); n %= v; } }
  if (n > 0) parts.push(below1000(n));
  return parts.join(" ");
}
/** "AED One Thousand Two Hundred and 05/100 Only"; 3-decimal currencies: "OMR One Thousand Two Hundred and 250/1000 Only". */
export function amountInWords(amount: number, currency = "AED"): string {
  const dec = currencyDecimals(currency), base = 10 ** dec;
  const minor = Math.round(Math.abs(amount) * base);
  const whole = Math.floor(minor / base), frac = minor % base;
  return `${currency} ${integerInWords(whole)}${frac ? ` and ${String(frac).padStart(dec, "0")}/${base}` : ""} Only`;
}
