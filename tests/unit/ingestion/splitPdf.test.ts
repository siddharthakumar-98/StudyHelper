import { randomBytes } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { InvalidPdfError, splitPdf } from "@/modules/ingestion/splitPdf";
import { makePdf } from "../../fixtures/makePdf";

describe("splitPdf", () => {
  it("returns one single-page PDF per page", async () => {
    const outputs = await splitPdf(await makePdf({ pages: 3 }));
    expect(outputs).toHaveLength(3);
    for (const bytes of outputs) {
      const doc = await PDFDocument.load(bytes);
      expect(doc.getPageCount()).toBe(1);
    }
  });

  it("does not carry a large attachment into each page", async () => {
    const outputs = await splitPdf(await makePdf({ pages: 2, padBytes: 2_000_000 }));
    expect(outputs).toHaveLength(2);
    for (const bytes of outputs) expect(bytes.byteLength).toBeLessThan(100_000);
  });

  it("throws InvalidPdfError for bytes that are not a PDF", async () => {
    await expect(splitPdf(randomBytes(2000))).rejects.toBeInstanceOf(InvalidPdfError);
  });

  it("throws InvalidPdfError for a truncated PDF", async () => {
    const bytes = await makePdf({ pages: 2 });
    await expect(splitPdf(bytes.slice(0, 40))).rejects.toBeInstanceOf(InvalidPdfError);
  });
});
