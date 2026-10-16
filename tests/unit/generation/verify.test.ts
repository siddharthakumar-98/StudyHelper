import { describe, expect, it } from "vitest";
import type { AiCallInput } from "@/modules/ai/client";
import { createFakeAiClient, DEFAULT_FAKE_RESPONDERS } from "@/modules/ai/fake";
import type { Verification } from "@/modules/ai/schemas/verification";
import type { SlideForGeneration } from "@/modules/generation/generate";
import {
  checkDuplicate,
  DUPLICATE_AUTO_THRESHOLD,
  verifyQuestion,
  type QuestionWithKey,
} from "@/modules/generation/verify";

const DOC_ID = "ab12cd34-0000-4000-8000-000000000000";

const slide: SlideForGeneration = {
  id: "slide-uuid-1",
  label: "Slide 41",
  pageId: "page-uuid-1",
  title: "Insulin dosing",
  verbatim_text: "C:I ratio = 500/TDD",
  tables: [],
  diagram_description: null,
};

const mcq: QuestionWithKey = {
  id: "q-mcq",
  type: "mcq",
  stem: "How is the carbohydrate-to-insulin ratio estimated from the total daily dose?",
  options: [
    { id: "a", text: "500/TDD" },
    { id: "b", text: "1650/TDD" },
    { id: "c", text: "1800/TDD" },
    { id: "d", text: "300/TDD" },
  ],
  difficulty: "easy",
  basisQuote: "C:I ratio = 500/TDD",
  sourceSlideIds: [slide.id],
  correctOptionId: "a",
  explanation: "The ratio is 500 divided by the total daily dose.",
  modelAnswer: null,
  rubric: null,
};

const saq: QuestionWithKey = {
  id: "q-saq",
  type: "saq",
  stem: "Explain how to estimate the carbohydrate-to-insulin ratio.",
  options: null,
  difficulty: "medium",
  basisQuote: "C:I ratio = 500/TDD",
  sourceSlideIds: [slide.id],
  correctOptionId: null,
  explanation: null,
  modelAnswer: "Divide 500 by the total daily insulin dose.",
  rubric: {
    criteria: [
      { id: "c1", statement: "Uses 500", weight: 2, equivalents: [], partial_credit_examples: [] },
      { id: "c2", statement: "Divides by TDD", weight: 2, equivalents: [], partial_credit_examples: [] },
      { id: "c3", statement: "Units are grams per unit", weight: 1, equivalents: [], partial_credit_examples: [] },
    ],
    critical_errors: [],
  },
};

const clean: Verification = {
  answer_supported_by_slide: true,
  single_best_answer_ok: true,
  rubric_consistent: null,
  ambiguous: false,
  stem_gives_away_answer: false,
  guideline_conflict: null,
  issues: [],
  pass: true,
};

/** A fake whose verifier answers `verification` and records every call. */
function verifierAnswering(verification: Partial<Verification>) {
  const calls: AiCallInput<unknown>[] = [];
  const ai = createFakeAiClient({
    verify: (input) => {
      calls.push(input);
      return { ...clean, ...verification };
    },
  });
  return { ai, calls };
}

const textOf = (input: AiCallInput<unknown>) =>
  input.content
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("\n");

describe("verifyQuestion", () => {
  it("passes a clean MCQ", async () => {
    const { ai } = verifierAnswering({});
    expect(await verifyQuestion(mcq, [slide], ai, DOC_ID)).toEqual({
      pass: true,
      notes: [],
      conflictNote: null,
    });
  });

  it("fails an ambiguous question even when the model says pass", async () => {
    const { ai } = verifierAnswering({ ambiguous: true, pass: true });
    const result = await verifyQuestion(mcq, [slide], ai, DOC_ID);
    expect(result.pass).toBe(false);
    expect(result.notes).toContain("Verifier: the question is ambiguous");
  });

  it("fails an MCQ whose single-best-answer check is null", async () => {
    const { ai } = verifierAnswering({ single_best_answer_ok: null, rubric_consistent: true });
    const result = await verifyQuestion(mcq, [slide], ai, DOC_ID);
    expect(result.pass).toBe(false);
    expect(result.notes).toContain("Verifier: the MCQ does not have exactly one defensible answer");
  });

  it("judges an SAQ by its rubric check, not the MCQ one", async () => {
    const good = verifierAnswering({ single_best_answer_ok: null, rubric_consistent: true });
    expect((await verifyQuestion(saq, [slide], good.ai, DOC_ID)).pass).toBe(true);
    const bad = verifierAnswering({ single_best_answer_ok: true, rubric_consistent: null });
    const result = await verifyQuestion(saq, [slide], bad.ai, DOC_ID);
    expect(result.pass).toBe(false);
    expect(result.notes).toContain("Verifier: the rubric does not match the model answer");
  });

  it("fails when the model fails it, and keeps the model's issues as notes", async () => {
    const { ai } = verifierAnswering({ pass: false, issues: ["Two slides give different ratios"] });
    expect(await verifyQuestion(mcq, [slide], ai, DOC_ID)).toEqual({
      pass: false,
      notes: ["Verifier: Two slides give different ratios"],
      conflictNote: null,
    });
  });

  it("names every failed check and gives a reason even when the model lists none", async () => {
    const { ai } = verifierAnswering({
      answer_supported_by_slide: false,
      stem_gives_away_answer: true,
      pass: false,
    });
    expect((await verifyQuestion(mcq, [slide], ai, DOC_ID)).notes).toEqual([
      "Verifier: the answer is not supported by the cited slide",
      "Verifier: the stem gives the answer away",
    ]);
    const silent = verifierAnswering({ pass: false });
    expect((await verifyQuestion(mcq, [slide], silent.ai, DOC_ID)).notes).toEqual([
      "Verifier: the reviewer failed the question without giving a reason",
    ]);
  });

  it("returns a guideline conflict without failing the question", async () => {
    const { ai } = verifierAnswering({
      guideline_conflict: "  The slide says 150 min/week; current guidelines say at least 150 min/week.  ",
    });
    expect(await verifyQuestion(mcq, [slide], ai, DOC_ID)).toEqual({
      pass: true,
      notes: [],
      conflictNote: "The slide says 150 min/week; current guidelines say at least 150 min/week.",
    });
    const blank = verifierAnswering({ guideline_conflict: "   " });
    expect((await verifyQuestion(mcq, [slide], blank.ai, DOC_ID)).conflictNote).toBeNull();
  });

  it("shows the reviewer the question, its key and the cited slides only", async () => {
    const { ai, calls } = verifierAnswering({});
    await verifyQuestion(mcq, [slide], ai, DOC_ID);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ task: "verify", promptVersion: "verify-question@1", documentId: DOC_ID });
    const text = textOf(calls[0]);
    expect(text).toContain(mcq.stem);
    expect(text).toContain("b) 1650/TDD");
    expect(text).toContain("Correct option: a");
    expect(text).toContain(mcq.explanation!);
    expect(text).toContain("[S1] Slide 41");
    expect(text).toContain("C:I ratio = 500/TDD");
    expect(text).not.toContain(slide.id);

    const saqCall = verifierAnswering({ single_best_answer_ok: null, rubric_consistent: true });
    await verifyQuestion(saq, [slide], saqCall.ai, DOC_ID);
    const saqText = textOf(saqCall.calls[0]);
    expect(saqText).toContain(saq.modelAnswer!);
    expect(saqText).toContain("c3 (1 mark): Units are grams per unit");
  });

  it("attaches the page photo for a slide with a table, as generation does", async () => {
    const tableSlide: SlideForGeneration = {
      ...slide,
      tables: [{ caption: null, rows: [["Ratio", "Formula"], ["C:I", "500/TDD"]] }],
    };
    const { ai, calls } = verifierAnswering({});
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
    await verifyQuestion(mcq, [tableSlide], ai, DOC_ID, new Map([[slide.pageId, pdf]]));
    expect(calls[0].content.filter((b) => b.type === "document")).toHaveLength(1);
    expect(textOf(calls[0])).toContain("Page photo for S1:");

    const plain = verifierAnswering({});
    await verifyQuestion(mcq, [slide], plain.ai, DOC_ID, new Map([[slide.pageId, pdf]]));
    expect(plain.calls[0].content.filter((b) => b.type !== "text")).toHaveLength(0);
  });
});

describe("checkDuplicate", () => {
  const q = { id: "q-new", stem: "What is the C:I ratio formula?" };

  function dedupAnswering(answer: { duplicate_of_question_id: string | null; reason: string }) {
    const calls: AiCallInput<unknown>[] = [];
    const ai = createFakeAiClient({
      dedup: (input) => {
        calls.push(input);
        return answer;
      },
    });
    return { ai, calls };
  }

  it("makes no AI call when there are no candidates", async () => {
    const { ai, calls } = dedupAnswering({ duplicate_of_question_id: "Q1", reason: "x" });
    expect(await checkDuplicate(q, [], ai, DOC_ID)).toEqual({ duplicateOf: null, reason: "" });
    expect(calls).toHaveLength(0);
  });

  it("treats a near-identical stem as a duplicate without an AI call", async () => {
    expect(DUPLICATE_AUTO_THRESHOLD).toBe(0.9);
    const { ai, calls } = dedupAnswering({ duplicate_of_question_id: null, reason: "x" });
    const result = await checkDuplicate(
      q,
      [
        { question_id: "q-old", stem: "What is the C:I ratio formula ?", sim: 0.95 },
        { question_id: "q-other", stem: "Something else", sim: 0.5 },
      ],
      ai,
      DOC_ID,
    );
    expect(result).toEqual({ duplicateOf: "q-old", reason: "Nearly identical wording (similarity 0.95)" });
    expect(calls).toHaveLength(0);
  });

  it("asks the model once below the threshold and maps its short id back", async () => {
    const { ai, calls } = dedupAnswering({ duplicate_of_question_id: "Q2", reason: "Both test 500/TDD" });
    const result = await checkDuplicate(
      q,
      [
        { question_id: "q-a", stem: "Which formula gives the correction factor?", sim: 0.6 },
        { question_id: "q-b", stem: "How is the C:I ratio calculated?", sim: 0.5 },
      ],
      ai,
      DOC_ID,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ task: "dedup", promptVersion: "dedup@1", documentId: DOC_ID });
    const text = textOf(calls[0]);
    expect(text).toContain(q.stem);
    expect(text).toContain("[Q1] Which formula gives the correction factor?");
    expect(text).toContain("[Q2] How is the C:I ratio calculated?");
    expect(text).not.toContain("q-a");
    expect(result).toEqual({ duplicateOf: "q-b", reason: "Both test 500/TDD" });
  });

  it("does not retire a question for an id the model invented", async () => {
    const { ai } = dedupAnswering({ duplicate_of_question_id: "Q9", reason: "made up" });
    const result = await checkDuplicate(
      q,
      [{ question_id: "q-a", stem: "How is the C:I ratio calculated?", sim: 0.6 }],
      ai,
      DOC_ID,
    );
    expect(result.duplicateOf).toBeNull();
  });
});

describe("default fake verify and dedup", () => {
  const ai = createFakeAiClient(DEFAULT_FAKE_RESPONDERS);

  it("passes unless the stem contains FAIL", async () => {
    expect((await verifyQuestion(mcq, [slide], ai, DOC_ID)).pass).toBe(true);
    expect((await verifyQuestion(saq, [slide], ai, DOC_ID)).pass).toBe(true);
    const failing = await verifyQuestion({ ...saq, stem: `${saq.stem} FAIL` }, [slide], ai, DOC_ID);
    expect(failing.pass).toBe(false);
    expect(failing.notes.length).toBeGreaterThan(0);
  });

  it("is never a duplicate unless the stem contains DUP", async () => {
    const candidates = [{ question_id: "q-a", stem: "How is the C:I ratio calculated?", sim: 0.6 }];
    expect((await checkDuplicate(q(), candidates, ai, DOC_ID)).duplicateOf).toBeNull();
    expect((await checkDuplicate(q("DUP"), candidates, ai, DOC_ID)).duplicateOf).toBe("q-a");
    function q(suffix = "") {
      return { id: "q-new", stem: `What is the C:I ratio? ${suffix}`.trim() };
    }
  });
});
