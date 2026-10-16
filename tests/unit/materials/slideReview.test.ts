import { describe, expect, it } from "vitest";
import { needsChecking, parseTables, splitUncertain } from "@/components/materials/slideReview";

describe("needsChecking", () => {
  it("is false only for a clear slide with no uncertain terms", () => {
    expect(needsChecking({ legibility: "clear", uncertainTerms: [] })).toBe(false);
    expect(needsChecking({ legibility: "partial", uncertainTerms: [] })).toBe(true);
    expect(needsChecking({ legibility: "unreadable", uncertainTerms: [] })).toBe(true);
    expect(needsChecking({ legibility: "clear", uncertainTerms: ["x"] })).toBe(true);
  });
});

describe("splitUncertain", () => {
  it("marks [?word?] spans and keeps the rest", () => {
    expect(splitUncertain("Give [?glipizide?] 5 mg, then [?x?]")).toEqual([
      { text: "Give ", uncertain: false },
      { text: "glipizide", uncertain: true },
      { text: " 5 mg, then ", uncertain: false },
      { text: "x", uncertain: true },
    ]);
  });

  it("returns plain text unchanged", () => {
    expect(splitUncertain("Plain")).toEqual([{ text: "Plain", uncertain: false }]);
    expect(splitUncertain("")).toEqual([]);
  });
});

describe("parseTables", () => {
  it("accepts well-formed tables and ignores junk", () => {
    expect(parseTables([{ caption: "Doses", rows: [["a", "b"]] }, null, { rows: "no" }])).toEqual([
      { caption: "Doses", rows: [["a", "b"]] },
    ]);
    expect(parseTables("nope")).toEqual([]);
  });
});
