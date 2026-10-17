import { describe, expect, it } from "vitest";
import { containsNormalized, normalizeForMatch } from "@/lib/text";

describe("normalizeForMatch", () => {
  it("drops a leading bullet, collapses whitespace and lowercases", () => {
    expect(normalizeForMatch("• HbA1c  ≥ 6.5%")).toBe("hba1c ≥ 6.5%");
  });

  it("treats curly and straight quotes as equal", () => {
    expect(normalizeForMatch("“Treat to target” isn’t optional")).toBe(
      normalizeForMatch("\"Treat to target\" isn't optional"),
    );
  });

  it("removes bullets at the start of every line", () => {
    expect(normalizeForMatch("▪ Metformin\n* Gliclazide\n- Insulin")).toBe(
      "metformin gliclazide insulin",
    );
  });
});

describe("normalizeForMatch: minus sign (item 6)", () => {
  it("treats the Unicode minus sign (U+2212) as a hyphen-minus", () => {
    expect(normalizeForMatch("HbA1c \u2212 0.5%")).toBe("hba1c - 0.5%");
    expect(containsNormalized("Target: \u22121.0 SD", "-1.0 sd")).toBe(true);
  });
});

describe("containsNormalized", () => {
  it("finds a hyphenated needle in a haystack that uses an em dash", () => {
    expect(containsNormalized("Target HbA1c — 7% for most adults", "hba1c - 7%")).toBe(true);
  });

  it("finds a needle typed with an en dash in a hyphenated haystack", () => {
    expect(containsNormalized("FPG 80-130 mg/dL", "80–130 mg/dL")).toBe(true);
  });

  it("returns false when the needle is absent", () => {
    expect(containsNormalized("Metformin 500 mg", "1000 mg")).toBe(false);
  });
});
