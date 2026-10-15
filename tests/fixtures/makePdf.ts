import { randomBytes } from "node:crypto";
import { PDFDocument, StandardFonts } from "pdf-lib";

/**
 * Builds a test PDF with "Fixture page N" drawn on each page. `padBytes` embeds an
 * attachment of that many random bytes (incompressible), which is how the 20 MB
 * fixture is made without committing a large file.
 */
export async function makePdf({
  pages,
  padBytes,
}: {
  pages: number;
  padBytes?: number;
}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let n = 1; n <= pages; n++) {
    const page = doc.addPage([400, 300]);
    page.drawText(`Fixture page ${n}`, { x: 40, y: 150, size: 24, font });
  }
  if (padBytes && padBytes > 0) {
    await doc.attach(randomBytes(padBytes), "padding.bin", {
      mimeType: "application/octet-stream",
    });
  }
  return doc.save({ useObjectStreams: false });
}
