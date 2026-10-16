import { describe, expect, it } from "vitest";
import { validateGenerated, validateStructure } from "@/modules/generation/validate";
import type { SlideForGeneration } from "@/modules/generation/generate";
import type { GeneratedMcq, GeneratedSaq } from "@/modules/ai/schemas/generation";

const slide: SlideForGeneration = {
  id: "slide-1",
  label: "Slide 41",
  pageId: "page-1",
  title: "Insulin dosing",
  verbatim_text: "• C:I ratio = 500/TDD\n• Correction factor — 1650/TDD",
  tables: [{ caption: "Targets", rows: [["Measure", "Goal"], ["Fasting glucose", "80–130 mg/dL"]] }],
  diagram_description: "Arrow from 'Basal insulin' to 'Fasting glucose'",
};
const slides = new Map([[slide.id, slide]]);

function mcq(overrides: Partial<GeneratedMcq> = {}): GeneratedMcq {
  return {
    stem: "Which formula gives the carbohydrate-to-insulin ratio?",
    options: [
      { id: "a", text: "500/TDD" },
      { id: "b", text: "1650/TDD" },
      { id: "c", text: "1800/TDD" },
      { id: "d", text: "100/TDD" },
    ],
    correct_option_id: "a",
    explanation: "The slide gives the C:I ratio as 500/TDD; 1650/TDD is the correction factor.",
    difficulty: "easy",
    source_slide_ids: ["slide-1"],
    basis_quote: "C:I ratio = 500/TDD",
    conflict_note: null,
    ...overrides,
  };
}

function saq(overrides: Partial<GeneratedSaq> = {}): GeneratedSaq {
  return {
    stem: "Explain how to calculate the carbohydrate-to-insulin ratio and the correction factor.",
    model_answer: "C:I ratio = 500/TDD. Correction factor = 1650/TDD.",
    key_concepts: [{ concept: "C:I ratio = 500/TDD", equivalents: ["insulin-to-carb ratio 500 rule"] }],
    rubric: {
      criteria: [
        { id: "c1", statement: "States C:I = 500/TDD", weight: 2, equivalents: [], partial_credit_examples: [] },
        { id: "c2", statement: "States CF = 1650/TDD", weight: 2, equivalents: [], partial_credit_examples: [] },
        { id: "c3", statement: "Defines TDD", weight: 1, equivalents: [], partial_credit_examples: [] },
      ],
      critical_errors: [],
    },
    difficulty: "medium",
    source_slide_ids: ["slide-1"],
    basis_quote: "Correction factor - 1650/TDD",
    conflict_note: null,
    ...overrides,
  };
}

const criterion = (id: string, weight: number) => ({
  id,
  statement: `Criterion ${id}`,
  weight,
  equivalents: [],
  partial_credit_examples: [],
});

describe("validateStructure", () => {
  it("accepts a valid MCQ and a valid SAQ", () => {
    expect(validateStructure(mcq())).toEqual([]);
    expect(validateStructure(saq())).toEqual([]);
  });

  it("needs options a, b, c, d exactly once", () => {
    const options = [
      { id: "a" as const, text: "One" },
      { id: "b" as const, text: "Two" },
      { id: "b" as const, text: "Three" },
      { id: "d" as const, text: "Four" },
    ];
    expect(validateStructure(mcq({ options }))).toContain("MCQ must have options a, b, c, d exactly once");
    expect(validateStructure(mcq({ options: mcq().options.slice(0, 3), correct_option_id: "a" }))).toContain(
      "MCQ must have options a, b, c, d exactly once",
    );
  });

  it("needs the correct option to be one of the options", () => {
    expect(
      validateStructure(mcq({ options: mcq().options.slice(0, 3), correct_option_id: "d" })),
    ).toContain("Correct option is not one of the options");
  });

  it("rejects two options with the same text", () => {
    const options = mcq().options.map((o) => (o.id === "c" ? { ...o, text: " 500/tdd " } : o));
    expect(validateStructure(mcq({ options }))).toEqual(["Two options have the same text"]);
  });

  it("rejects 'all/none of the above'", () => {
    for (const text of ["All of the above", "None of the above", "none of these"]) {
      const options = mcq().options.map((o) => (o.id === "d" ? { ...o, text } : o));
      expect(validateStructure(mcq({ options }))).toEqual(["Options must not use 'all/none of the above'"]);
    }
  });

  it("needs 3–6 rubric criteria", () => {
    const two = { criteria: [criterion("c1", 2.5), criterion("c2", 2.5)], critical_errors: [] };
    expect(validateStructure(saq({ rubric: two }))).toEqual(["Rubric needs 3–6 criteria"]);
    const seven = {
      criteria: Array.from({ length: 7 }, (_, i) => criterion(`c${i}`, 5 / 7)),
      critical_errors: [],
    };
    expect(validateStructure(saq({ rubric: seven }))).toEqual(["Rubric needs 3–6 criteria"]);
  });

  it("needs rubric weights that add up to 5.0, within 0.01", () => {
    const off = { criteria: [criterion("c1", 2), criterion("c2", 2), criterion("c3", 2)], critical_errors: [] };
    expect(validateStructure(saq({ rubric: off }))).toEqual(["Rubric weights must add up to 5.0"]);
    const close = {
      criteria: [criterion("c1", 1.67), criterion("c2", 1.67), criterion("c3", 1.67)],
      critical_errors: [],
    };
    expect(validateStructure(saq({ rubric: close }))).toEqual([]);
  });

  it("needs positive rubric weights", () => {
    const negative = { criteria: [criterion("c1", 3), criterion("c2", 2.5), criterion("c3", -0.5)], critical_errors: [] };
    expect(validateStructure(saq({ rubric: negative }))).toEqual(["Rubric weights must be positive"]);
  });

  it("needs a model answer", () => {
    expect(validateStructure(saq({ model_answer: "  \n " }))).toEqual(["Model answer is empty"]);
  });
});

describe("validateGenerated", () => {
  it("accepts questions quoting the slide's text, table cells or diagram description", () => {
    expect(validateGenerated(mcq(), slides)).toEqual([]);
    expect(validateGenerated(saq(), slides)).toEqual([]);
    expect(validateGenerated(mcq({ basis_quote: "Fasting glucose | 80-130 mg/dL" }), slides)).toEqual([]);
    expect(validateGenerated(mcq({ basis_quote: "80-130 mg/dL" }), slides)).toEqual([]);
    expect(validateGenerated(mcq({ basis_quote: "from ‘Basal insulin’" }), slides)).toEqual([]);
    expect(validateGenerated(mcq({ basis_quote: "Insulin dosing" }), slides)).toEqual([]);
  });

  it("reports a cited slide outside this topic", () => {
    expect(validateGenerated(mcq({ source_slide_ids: ["slide-1", "S9"] }), slides)).toEqual([
      "Cites a slide outside this topic",
    ]);
  });

  it("reports a basis quote that is not in the cited slide", () => {
    expect(validateGenerated(mcq({ basis_quote: "C:I ratio = 450/TDD" }), slides)).toEqual([
      "Basis quote not found in cited slide",
    ]);
  });

  it("reports an empty basis quote and a question that cites no slide", () => {
    expect(validateGenerated(mcq({ basis_quote: "  " }), slides)).toEqual([
      "Basis quote not found in cited slide",
    ]);
    expect(validateGenerated(mcq({ source_slide_ids: [] }), slides)).toEqual([
      "Basis quote not found in cited slide",
    ]);
  });

  it("includes the structural issues", () => {
    expect(validateGenerated(saq({ model_answer: "" }), slides)).toEqual(["Model answer is empty"]);
  });
});
