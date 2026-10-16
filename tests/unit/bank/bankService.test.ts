import { describe, expect, it } from "vitest";
import { BankError, buildEditedQuestion, refHeading, sourceLabelOf } from "@/modules/bank/bankService";

describe("refHeading", () => {
  it("adds the page to a printed slide number, as slideHeading does", () => {
    expect(refHeading({ label: "Slide 42", pageNo: 14 })).toBe("Slide 42 · page 14");
    expect(refHeading({ label: "Slide 39. 38.SGLT2-I", pageNo: 3 })).toBe("Slide 39. 38.SGLT2-I · page 3");
  });

  it("keeps the page-and-photo label of an unnumbered slide", () => {
    expect(refHeading({ label: "Page 2, photo 3", pageNo: 2 })).toBe("Page 2, photo 3");
  });

  it("uses an unfamiliar label as it is", () => {
    expect(refHeading({ label: "Appendix", pageNo: 9 })).toBe("Appendix");
  });
});

describe("sourceLabelOf", () => {
  const ref = (label: string, pageNo: number) => ({ documentId: "d", slideId: "s", label, pageNo });

  it("is empty without sources, one heading for one, and counts the rest", () => {
    expect(sourceLabelOf([])).toBe("");
    expect(sourceLabelOf([ref("Slide 42", 14)])).toBe("Slide 42 · page 14");
    expect(sourceLabelOf([ref("Slide 42", 14), ref("Slide 43", 14), ref("Page 2, photo 1", 2)])).toBe(
      "Slide 42 · page 14 + 2 more",
    );
  });
});

const mcqState = {
  type: "mcq" as const,
  options: [
    { id: "a", text: "500/TDD" },
    { id: "b", text: "1650/TDD" },
    { id: "c", text: "1800/TDD" },
    { id: "d", text: "300/TDD" },
  ],
  correctOptionId: "a",
  explanation: "Because.",
  modelAnswer: null,
  keyConcepts: null,
  rubric: null,
};

const rubric = (weights: number[]) => ({
  criteria: weights.map((weight, i) => ({
    id: `c${i + 1}`,
    statement: `Point ${i + 1}`,
    weight,
    equivalents: [],
    partial_credit_examples: [],
  })),
  critical_errors: [],
});

const saqState = {
  type: "saq" as const,
  options: null,
  correctOptionId: null,
  explanation: null,
  modelAnswer: "Model answer",
  keyConcepts: [{ concept: "k", equivalents: [] }],
  rubric: rubric([2, 1.5, 1.5]),
};

const base = { stem: "  New stem?  ", difficulty: "hard" as const };

describe("buildEditedQuestion", () => {
  it("keeps what the edit leaves out and trims the stem", () => {
    const built = buildEditedQuestion(mcqState, { ...base, correctOptionId: "c" });
    expect(built.stem).toBe("New stem?");
    expect(built.options).toEqual(mcqState.options);
    expect(built.key).toMatchObject({ correct_option_id: "c", explanation: "Because.", model_answer: null });
  });

  it("ignores fields of the other question type", () => {
    const built = buildEditedQuestion(mcqState, { ...base, modelAnswer: "x", rubric: rubric([1]) });
    expect(built.key.rubric).toBeNull();
    expect(built.key.model_answer).toBeNull();
    const saq = buildEditedQuestion(saqState, { ...base, correctOptionId: "b", options: [] });
    expect(saq.options).toBeNull();
    expect(saq.key.correct_option_id).toBeNull();
  });

  it("reports the validateStructure messages", () => {
    expect(() => buildEditedQuestion(saqState, { ...base, rubric: rubric([2, 1, 1]) })).toThrow(
      "Rubric weights must add up to 5.0",
    );
    expect(() =>
      buildEditedQuestion(mcqState, { ...base, options: mcqState.options.map((o) => ({ ...o, text: "same" })) }),
    ).toThrow("Two options have the same text");
    expect(() => buildEditedQuestion(saqState, { ...base, modelAnswer: "   " })).toThrow("Model answer is empty");
  });

  it("joins several messages and throws a BankError", () => {
    try {
      buildEditedQuestion(saqState, { ...base, modelAnswer: " ", rubric: rubric([1, 1]) });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(BankError);
      expect((error as Error).message).toContain("Rubric needs 3–6 criteria");
      expect((error as Error).message).toContain("Model answer is empty");
    }
  });

  it("rejects a blank stem, a blank option and an unusable shape", () => {
    expect(() => buildEditedQuestion(mcqState, { ...base, stem: " " })).toThrow(/question text/i);
    expect(() =>
      buildEditedQuestion(mcqState, {
        ...base,
        options: mcqState.options.map((o, i) => (i === 3 ? { ...o, text: "  " } : o)),
      }),
    ).toThrow(/Every option needs text/);
    expect(() => buildEditedQuestion(mcqState, { ...base, correctOptionId: "z" })).toThrow(BankError);
    expect(() => buildEditedQuestion(mcqState, { ...base, options: [{ id: "a", text: "x" }] })).toThrow(
      /options a, b, c, d/,
    );
  });
});
