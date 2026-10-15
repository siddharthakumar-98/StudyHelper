import { describe, expect, it } from "vitest";
import { slideLabel } from "@/modules/ingestion/slideLabel";

describe("slideLabel", () => {
  it("uses the printed slide number", () => {
    expect(slideLabel({ printed_slide_no: "42", page_no: 14, position_on_page: 2 })).toBe(
      "Slide 42",
    );
  });

  it("keeps an odd printed number exactly as printed", () => {
    expect(slideLabel({ printed_slide_no: "39. 38", page_no: 12, position_on_page: 1 })).toBe(
      "Slide 39. 38",
    );
  });

  it("falls back to page and photo position when there is no printed number", () => {
    expect(slideLabel({ printed_slide_no: null, page_no: 2, position_on_page: 1 })).toBe(
      "Page 2, photo 1",
    );
  });

  it("gives two unnumbered photos on one page distinct labels", () => {
    const first = slideLabel({ printed_slide_no: null, page_no: 2, position_on_page: 1 });
    const second = slideLabel({ printed_slide_no: null, page_no: 2, position_on_page: 2 });
    expect(first).toBe("Page 2, photo 1");
    expect(second).toBe("Page 2, photo 2");
    expect(first).not.toBe(second);
  });

  it("treats a blank printed number as missing", () => {
    expect(slideLabel({ printed_slide_no: "  ", page_no: 3, position_on_page: 2 })).toBe(
      "Page 3, photo 2",
    );
  });
});
