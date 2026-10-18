import { describe, expect, it } from "vitest";
import { validateUploadFiles } from "@/modules/ingestion/validateUpload";

const MB = 1024 * 1024;

describe("validateUploadFiles", () => {
  it("asks for at least one file", () => {
    expect(validateUploadFiles([])).toEqual(["Choose at least one file"]);
  });

  it("rejects unsupported types", () => {
    expect(
      validateUploadFiles([{ name: "sample.gif", type: "image/gif", size: 1000 }]),
    ).toEqual(["sample.gif: only PDF, JPG, PNG or HEIC files can be added"]);
  });

  it("rejects files over 50 MB", () => {
    expect(
      validateUploadFiles([{ name: "big.pdf", type: "application/pdf", size: 51 * MB }]),
    ).toEqual(["big.pdf: file is larger than 50 MB"]);
  });

  it("accepts PDF, JPG, PNG and HEIC (by type or extension)", () => {
    expect(
      validateUploadFiles([
        { name: "a.pdf", type: "application/pdf", size: 10 * MB },
        { name: "b.jpg", type: "image/jpeg", size: MB },
        { name: "c.png", type: "image/png", size: MB },
        { name: "d.heic", type: "image/heic", size: MB },
        { name: "e.HEIC", type: "", size: MB },
      ]),
    ).toEqual([]);
  });

  it("accepts exactly 50 MB", () => {
    expect(
      validateUploadFiles([{ name: "ok.pdf", type: "application/pdf", size: 50 * MB }]),
    ).toEqual([]);
  });
});
