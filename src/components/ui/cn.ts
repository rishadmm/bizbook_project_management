import clsx, { type ClassValue } from "clsx";
/** className combiner (clsx). */
export const cn = (...v: ClassValue[]): string => clsx(v);
