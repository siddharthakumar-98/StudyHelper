import { describe, expect, it } from "vitest";
import {
  expandSplitBatches,
  halves,
  isSkippedBatch,
  readRunReport,
} from "@/modules/generation/batchPlan";

type B = { batchKey: string; slides: string[] };
const make = (parent: B, slides: string[], batchKey: string): B => ({ ...parent, slides, batchKey });

describe("halves", () => {
  it("splits in order, the first half taking the odd one", () => {
    expect(halves([1, 2, 3, 4, 5, 6])).toEqual([[1, 2, 3], [4, 5, 6]]);
    expect(halves([1, 2, 3])).toEqual([[1, 2], [3]]);
    expect(halves([1, 2])).toEqual([[1], [2]]);
  });
});

describe("expandSplitBatches", () => {
  const plan: B[] = [
    { batchKey: "t1:0", slides: ["a", "b", "c", "d", "e", "f"] },
    { batchKey: "t1:1", slides: ["g"] },
    { batchKey: "t2:0", slides: ["h", "i"] },
  ];

  it("leaves the plan alone when nothing was split", () => {
    expect(expandSplitBatches(plan, new Set(), make)).toEqual(plan);
  });

  it("replaces a split batch by its halves .a and .b, recursively and in order", () => {
    const out = expandSplitBatches(plan, new Set(["t1:0", "t1:0.b", "t2:0"]), make);
    expect(out.map((b) => [b.batchKey, b.slides.join("")])).toEqual([
      ["t1:0.a", "abc"],
      ["t1:0.b.a", "de"],
      ["t1:0.b.b", "f"],
      ["t1:1", "g"],
      ["t2:0.a", "h"],
      ["t2:0.b", "i"],
    ]);
  });

  it("is deterministic: the same split keys give the same sub-batches every time", () => {
    const keys = new Set(["t1:0", "t1:0.a"]);
    expect(expandSplitBatches(plan, keys, make)).toEqual(expandSplitBatches(plan, keys, make));
  });

  it("never splits a single-slide batch", () => {
    expect(expandSplitBatches(plan, new Set(["t1:1"]), make)[1]).toEqual(plan[1]);
  });
});

describe("readRunReport", () => {
  it("reads the split keys and skipped batches, tolerating an empty or odd report", () => {
    expect(readRunReport(null)).toEqual({ splitBatches: [], skippedBatches: [] });
    expect(readRunReport({ splitBatches: "x", skippedBatches: [{ nope: 1 }] })).toEqual({
      splitBatches: [],
      skippedBatches: [],
    });
    const skipped = { batchKey: "t:0.a", slideIds: ["s1"], slideLabels: ["Slide 1"], reason: "cut off" };
    expect(readRunReport({ splitBatches: ["t:0"], skippedBatches: [skipped] })).toEqual({
      splitBatches: ["t:0"],
      skippedBatches: [skipped],
    });
  });
});

describe("isSkippedBatch", () => {
  const skipped = [{ batchKey: "t:0.a", slideIds: ["s1"], slideLabels: ["Slide 1"], reason: "cut off" }];
  it("matches on the batch key and the same slides", () => {
    expect(isSkippedBatch(skipped, "t:0.a", ["s1"])).toBe(true);
    expect(isSkippedBatch(skipped, "t:0.a", ["s2"])).toBe(false);
    expect(isSkippedBatch(skipped, "t:0.b", ["s1"])).toBe(false);
  });
});
