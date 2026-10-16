import { describe, expect, it } from "vitest";
import {
  buildQuestionEdit,
  mcqFormFrom,
  saqFormFrom,
  type McqForm,
  type SaqForm,
} from "@/components/bank/editQuestion";

const mcq: McqForm = {
  stem: "  Which ratio?  ",
  difficulty: "medium",
  options: [
    { id: "a", text: "500/TDD" },
    { id: "b", text: "1650/TDD" },
    { id: "c", text: "1800/TDD" },
    { id: "d", text: "300/TDD" },
  ],
  correctOptionId: "a",
  explanation: "The slide gives 500/TDD.",
};

const saq: SaqForm = {
  stem: "Explain the C:I ratio.",
  difficulty: "easy",
  modelAnswer: "500 divided by TDD.",
  keyConcepts: [{ concept: "500/TDD", equivalents: "500 over TDD, 500 rule" }],
  criteria: [
    { id: "c1", statement: "Names 500", weight: "2", equivalents: [], partialCreditExamples: [] },
    { id: "c2", statement: "Divides by TDD", weight: "1.5", equivalents: ["over"], partialCreditExamples: ["x"] },
    { id: "c3", statement: "Gives the unit", weight: "1.5", equivalents: [], partialCreditExamples: [] },
  ],
  criticalErrors: [{ id: "e1", statement: "Uses 1800" }],
};

describe("buildQuestionEdit", () => {
  it("builds an MCQ edit with everything the server needs", () => {
    expect(buildQuestionEdit("mcq", mcq)).toEqual({
      ok: true,
      edit: {
        stem: "Which ratio?",
        difficulty: "medium",
        options: mcq.options,
        correctOptionId: "a",
        explanation: "The slide gives 500/TDD.",
      },
    });
  });

  it("builds an SAQ edit, splitting wordings on commas and keeping hidden rubric fields", () => {
    const result = buildQuestionEdit("saq", saq);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.edit.keyConcepts).toEqual([
      { concept: "500/TDD", equivalents: ["500 over TDD", "500 rule"] },
    ]);
    expect(result.edit.rubric?.criteria[1]).toEqual({
      id: "c2",
      statement: "Divides by TDD",
      weight: 1.5,
      equivalents: ["over"],
      partial_credit_examples: ["x"],
    });
    expect(result.edit.rubric?.critical_errors).toEqual([{ id: "e1", statement: "Uses 1800" }]);
  });

  it("reports a weight that is not a number, in plain words", () => {
    const bad = { ...saq, criteria: [{ ...saq.criteria[0], weight: "two" }, ...saq.criteria.slice(1)] };
    expect(buildQuestionEdit("saq", bad)).toEqual({
      ok: false,
      issues: ['The weight for "Names 500" must be a number'],
    });
  });

  it("reports a missing question text before anything is sent", () => {
    expect(buildQuestionEdit("mcq", { ...mcq, stem: "   " })).toEqual({
      ok: false,
      issues: ["Write the question text"],
    });
  });

  it("refuses essays", () => {
    expect(buildQuestionEdit("essay", mcq)).toEqual({
      ok: false,
      issues: ["Essay questions cannot be edited here"],
    });
  });
});

describe("form starters", () => {
  it("starts an MCQ form from the loaded question", () => {
    const form = mcqFormFrom({
      stem: "S",
      difficulty: "easy",
      options: [{ id: "a", text: "x" }],
      key: { correctOptionId: "a", explanation: "why" },
    });
    expect(form.correctOptionId).toBe("a");
    expect(form.explanation).toBe("why");
    expect(form.options.map((o) => o.id)).toEqual(["a", "b", "c", "d"]);
    expect(form.options[0].text).toBe("x");
    expect(form.options[1].text).toBe("");
  });

  it("starts an SAQ form with wordings joined by commas and weights as text", () => {
    const form = saqFormFrom({
      stem: "S",
      difficulty: "hard",
      key: {
        modelAnswer: "m",
        keyConcepts: [{ concept: "c", equivalents: ["a", "b"] }],
        rubric: {
          criteria: [{ id: "c1", statement: "s", weight: 2.5, equivalents: [], partial_credit_examples: [] }],
          critical_errors: [{ id: "e1", statement: "bad" }],
        },
      },
    });
    expect(form.keyConcepts).toEqual([{ concept: "c", equivalents: "a, b" }]);
    expect(form.criteria[0].weight).toBe("2.5");
    expect(form.criticalErrors).toEqual([{ id: "e1", statement: "bad" }]);
  });
});
