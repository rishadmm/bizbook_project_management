// Placeholder documents of the demo seeds.
/** A minimal but valid one-page PDF (placeholder document). */
export function miniPdf(title: string, lines: string[]): Buffer {
  const esc = (t: string) => t.replace(/[\\()]/g, "\\$&").replace(/[^\x20-\x7e]/g, "?");
  const body = ["BT /F1 18 Tf 56 780 Td (" + esc(title) + ") Tj ET", ...lines.map((l, i) => `BT /F1 11 Tf 56 ${740 - i * 18} Td (${esc(l)}) Tj ET`)].join("\n");
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${Buffer.byteLength(body)} >>\nstream\n${body}\nendstream`, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offs: number[] = [];
  objs.forEach((o, i) => { offs.push(Buffer.byteLength(out)); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

