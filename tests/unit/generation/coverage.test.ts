import { describe, expect, it } from "vitest";
import {
  DEFAULT_TARGET,
  buildCoverageReport,
  type CoverageInput,
} from "@/modules/generation/coverage";

type Q = CoverageInput["questions"][number];

const topics = [{ id: "t1", name: "Insulin" }];

function q(over: Partial<Q> & Pick<Q, "id">): Q {
  return {
    type: "mcq",
    difficulty: "easy",
    status: "active",
    topicId: "t1",
    sourceSlideIds: ["s-ok"],
    ...over,
  };
}

const base: CoverageInput = {
  target: 100,
  topics,
  slides: [{ id: "s-ok", label: "Slide 1 · page 1", legibility: "clear", topicIds: ["t1"] }],
  questions: [],
};

describe("buildCoverageReport", () => {
  it("lists unreadable, unassigned and question-less slides with the right reasons", () => {
    const report = buildCoverageReport({
      ...base,
      slides: [
        { id: "s-blur", label: "Slide 2 · page 1", legibility: "unreadable", topicIds: [] },
        { id: "s-none", label: "Page 2, photo 1", legibility: "clear", topicIds: [] },
        { id: "s-empty", label: "Slide 4 · page 3", legibility: "partial", topicIds: ["t1"] },
        { id: "s-ok", label: "Slide 5 · page 3", legibility: "clear", topicIds: ["t1"] },
      ],
      questions: [q({ id: "q1", sourceSlideIds: ["s-ok"] })],
    });
    expect(report.slidesWithoutQuestions).toEqual([
      { slideId: "s-blur", label: "Slide 2 · page 1", reason: "unreadable" },
      { slideId: "s-none", label: "Page 2, photo 1", reason: "not in any topic" },
      { slideId: "s-empty", label: "Slide 4 · page 3", reason: "no question generated" },
    ]);
  });

  it("lists slides of a batch the generator had to skip as could not be processed automatically (R37)", () => {
    const report = buildCoverageReport({
      ...base,
      slides: [
        { id: "s-skip", label: "Slide 7 · page 4", legibility: "clear", topicIds: ["t1"] },
        { id: "s-blur", label: "Slide 8 · page 4", legibility: "unreadable", topicIds: [] },
        { id: "s-ok", label: "Slide 9 · page 4", legibility: "clear", topicIds: ["t1"] },
      ],
      questions: [q({ id: "q1", sourceSlideIds: ["s-ok"] })],
      skippedSlideIds: ["s-skip", "s-blur"],
    });
    expect(report.slidesWithoutQuestions).toEqual([
      { slideId: "s-skip", label: "Slide 7 · page 4", reason: "could not be processed automatically" },
      { slideId: "s-blur", label: "Slide 8 · page 4", reason: "unreadable" },
    ]);
  });

  it("does not list a slide that a question needing review cites, but does if only a retired one does", () => {
    const report = buildCoverageReport({
      ...base,
      slides: [
        { id: "s-a", label: "A", legibility: "clear", topicIds: ["t1"] },
        { id: "s-b", label: "B", legibility: "clear", topicIds: ["t1"] },
      ],
      questions: [
        q({ id: "q1", status: "needs_review", sourceSlideIds: ["s-a"] }),
        q({ id: "q2", status: "retired", sourceSlideIds: ["s-b"] }),
      ],
    });
    expect(report.slidesWithoutQuestions.map((s) => s.slideId)).toEqual(["s-b"]);
  });

  it("counts totals by status and per-topic cells for active questions only", () => {
    const questions: Q[] = [
      q({ id: "1", type: "mcq", difficulty: "easy" }),
      q({ id: "2", type: "mcq", difficulty: "easy" }),
      q({ id: "3", type: "mcq", difficulty: "hard" }),
      q({ id: "4", type: "mcq", difficulty: "medium" }),
      q({ id: "5", type: "saq", difficulty: "medium" }),
      q({ id: "6", type: "saq", difficulty: "hard" }),
      q({ id: "7", type: "saq", difficulty: "hard" }),
      q({ id: "8", status: "needs_review" }),
      q({ id: "9", status: "needs_review", type: "saq" }),
      q({ id: "10", status: "retired" }),
    ];
    const report = buildCoverageReport({ ...base, questions });
    expect(report.totals).toEqual({ activeMcq: 4, activeSaq: 3, needsReview: 2, retired: 1 });
    expect(report.perTopic).toEqual([
      {
        topicId: "t1",
        name: "Insulin",
        slideCount: 1,
        mcq: { easy: 2, medium: 1, hard: 1 },
        saq: { easy: 0, medium: 1, hard: 2 },
      },
    ]);
  });

  it("states the shortfall exactly and does not claim the target is met", () => {
    const questions = Array.from({ length: 7 }, (_, i) => q({ id: `a${i}` }));
    const report = buildCoverageReport({ ...base, questions });
    expect(DEFAULT_TARGET).toBe(100);
    expect(report.targetMet).toBe(false);
    expect(report.shortfallNote).toBe(
      "Only 7 questions could be written from this material without repeating or going beyond the slides (target 100). Adding more handouts will increase coverage.",
    );
  });

  it("has no shortfall note once the target is met", () => {
    const questions = Array.from({ length: 5 }, (_, i) => q({ id: `a${i}` }));
    const report = buildCoverageReport({ ...base, target: 5, questions });
    expect(report.targetMet).toBe(true);
    expect(report.shortfallNote).toBeNull();
  });
});
