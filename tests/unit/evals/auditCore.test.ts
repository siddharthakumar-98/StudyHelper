import { describe, expect, it } from "vitest";
import {
  CHECKLIST_COLUMNS,
  refHeading,
  renderAudit,
  renderQuestion,
  sampleItems,
  sampleSize,
  type AuditQuestion,
} from "../../../evals/generation/auditCore";

const ids = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `q${String(i).padStart(3, "0")}` }));
const key = (x: { id: string }) => x.id;

describe("sampleSize", () => {
  it("is 20% rounded to the nearest question", () => {
    expect(sampleSize(100)).toBe(20);
    expect(sampleSize(12)).toBe(2);
    expect(sampleSize(13)).toBe(3);
    expect(sampleSize(27)).toBe(5);
  });

  it("is at least 1 when there is anything to sample, and 0 otherwise", () => {
    expect(sampleSize(1)).toBe(1);
    expect(sampleSize(2)).toBe(1);
    expect(sampleSize(0)).toBe(0);
  });
});

describe("sampleItems", () => {
  it("gives the same sample for the same seed, whatever order the items arrive in", () => {
    const items = ids(50);
    const a = sampleItems(items, 7, key);
    const b = sampleItems([...items].reverse(), 7, key);
    expect(a).toEqual(b);
    expect(a).toHaveLength(10);
  });

  it("gives different samples for different seeds", () => {
    const items = ids(50);
    expect(sampleItems(items, 1, key)).not.toEqual(sampleItems(items, 2, key));
  });

  it("returns distinct items in id order, and at least one from a tiny set", () => {
    const sample = sampleItems(ids(40), 3, key);
    expect(new Set(sample.map(key)).size).toBe(sample.length);
    expect(sample.map(key)).toEqual([...sample.map(key)].sort());
    expect(sampleItems(ids(3), 3, key)).toHaveLength(1);
    expect(sampleItems([], 3, key)).toEqual([]);
  });
});

const mcq: AuditQuestion = {
  id: "11111111-1111-1111-1111-111111111111",
  type: "mcq",
  difficulty: "medium",
  topic: "Insulin dosing",
  stem: "What is the correction factor rule?",
  options: [
    { id: "a", text: "1500 / TDD" },
    { id: "b", text: "1800 / TDD" },
  ],
  correctOptionId: "b",
  explanation: "The slide gives 1800.",
  modelAnswer: null,
  rubric: null,
  sourceRefs: [{ label: "Slide 42", pageNo: 14 }],
  basisQuote: "Correction factor = 1800 / TDD",
  conflictNote: "Slide 42 says 1800, slide 86 says 1500.",
};

describe("rendering", () => {
  it("formats source labels with their page", () => {
    expect(refHeading({ label: "Slide 42", pageNo: 14 })).toBe("Slide 42 · page 14");
    expect(refHeading({ label: "Page 2, photo 3", pageNo: 2 })).toBe("Page 2, photo 3");
  });

  it("marks the correct MCQ option, shows the source and conflict note, and ends with the checklist", () => {
    const md = renderQuestion(mcq, 1);
    expect(md).toContain("**[CORRECT]** B. 1800 / TDD");
    expect(md).toContain("[ ] A. 1500 / TDD");
    expect(md).toContain("Slide 42 · page 14");
    expect(md).toContain("Correction factor = 1800 / TDD");
    expect(md).toContain("Slide 42 says 1800, slide 86 says 1500.");
    expect(md).toContain(
      "| Supported by slide | Single best answer / rubric sound | Unambiguous | Difficulty right | Source correct | Notes |",
    );
    expect(CHECKLIST_COLUMNS).toHaveLength(6);
  });

  it("renders an SAQ with its model answer and rubric", () => {
    const md = renderQuestion(
      {
        ...mcq,
        type: "saq",
        options: null,
        correctOptionId: null,
        modelAnswer: "Divide 1800 by the total daily dose.",
        conflictNote: null,
        rubric: {
          criteria: [{ id: "c1", statement: "Uses 1800", weight: 5, equivalents: [], partial_credit_examples: [] }],
          critical_errors: [{ id: "e1", statement: "Uses the wrong rule" }],
        },
      },
      2,
    );
    expect(md).toContain("Divide 1800 by the total daily dose.");
    expect(md).toContain("c1 (5 marks): Uses 1800");
    expect(md).toContain("Critical error e1: Uses the wrong rule");
    expect(md).toContain("**Conflict note**: none");
  });

  it("states the sample size in the header", () => {
    const md = renderAudit({
      documentId: "d",
      documentTitle: "Handout",
      date: "2026-10-16",
      seed: 5,
      activeTotal: 12,
      sample: [mcq],
    });
    expect(md).toContain("# Generation audit 2026-10-16");
    expect(md).toContain("Sample: 1 of 12 active questions");
  });
});
