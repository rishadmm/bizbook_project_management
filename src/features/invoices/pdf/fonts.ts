import fs from "node:fs";
import path from "node:path";
import { Font } from "@react-pdf/renderer";

/** Registers Manrope from src/assets/fonts once; falls back to Helvetica when the files are missing. Returns the family name to use. */
let family: string | null = null;
export function pdfFontFamily(): string {
  if (family) return family;
  const dir = path.join(process.cwd(), "src", "assets", "fonts");
  const files = { 400: "Manrope_400Regular.ttf", 600: "Manrope_600SemiBold.ttf", 700: "Manrope_700Bold.ttf", 800: "Manrope_800ExtraBold.ttf" } as const;
  try {
    const fonts = Object.entries(files).map(([w, f]) => {
      const src = path.join(dir, f);
      if (!fs.existsSync(src)) throw new Error(`missing ${f}`);
      return { src, fontWeight: Number(w) as 400 | 600 | 700 | 800 };
    });
    // Manrope has no italic: map italic to the upright faces so a stray fontStyle never breaks rendering
    Font.register({ family: "Manrope", fonts: [...fonts, ...fonts.map((f) => ({ ...f, fontStyle: "italic" as const }))] });
    Font.registerHyphenationCallback((w) => [w]);
    family = "Manrope";
  } catch {
    family = "Helvetica";
  }
  return family;
}
