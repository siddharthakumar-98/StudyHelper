import { PDFDocument } from "pdf-lib";

export class InvalidPdfError extends Error {
  constructor(message = "This file is not a readable PDF") {
    super(message);
    this.name = "InvalidPdfError";
  }
}

const PDF_HEADER = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"

function looksLikePdf(bytes: Uint8Array): boolean {
  // Viewers tolerate a little junk before the header; so does the PDF spec (first 1024 bytes).
  const head = bytes.subarray(0, 1024);
  for (let i = 0; i + PDF_HEADER.length <= head.length; i++) {
    if (PDF_HEADER.every((b, j) => head[i + j] === b)) return true;
  }
  return false;
}

/** Splits a PDF into one single-page PDF per page, in page order. */
export async function splitPdf(bytes: Uint8Array): Promise<Uint8Array[]> {
  if (!looksLikePdf(bytes)) throw new InvalidPdfError();

  let source: PDFDocument;
  try {
    source = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (err) {
    throw new InvalidPdfError(
      `This file is not a readable PDF (${err instanceof Error ? err.message : "unknown error"})`,
    );
  }

  const outputs: Uint8Array[] = [];
  for (let i = 0; i < source.getPageCount(); i++) {
    const single = await PDFDocument.create();
    const [page] = await single.copyPages(source, [i]);
    single.addPage(page);
    outputs.push(await single.save());
  }
  return outputs;
}
