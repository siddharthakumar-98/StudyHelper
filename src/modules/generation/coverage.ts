import type { QuestionStatus } from "@/modules/bank/lifecycle";

export const DEFAULT_TARGET = 100;

type Difficulty = "easy" | "medium" | "hard";
type DifficultyCounts = Record<Difficulty, number>;

export type CoverageInput = {
  target: number;
  topics: { id: string; name: string }[];
  slides: {
    id: string;
    label: string;
    legibility: "clear" | "partial" | "unreadable";
    topicIds: string[];
  }[];
  questions: {
    id: string;
    type: "mcq" | "saq";
    difficulty: Difficulty;
    status: QuestionStatus;
    topicId: string;
    sourceSlideIds: string[];
  }[];
  /** Slides of batches the generator had to skip (generation_runs.report.skippedBatches, R37). */
  skippedSlideIds?: string[];
};

export type CoverageReport = {
  perTopic: {
    topicId: string;
    name: string;
    slideCount: number;
    mcq: DifficultyCounts;
    saq: DifficultyCounts;
  }[];
  totals: { activeMcq: number; activeSaq: number; needsReview: number; retired: number };
  slidesWithoutQuestions: {
    slideId: string;
    label: string;
    reason:
      | "unreadable"
      | "not in any topic"
      | "could not be processed automatically"
      | "no question generated";
  }[];
  targetMet: boolean;
  shortfallNote: string | null;
};

const zero = (): DifficultyCounts => ({ easy: 0, medium: 0, hard: 0 });

/**
 * Honest coverage of one handout: what its questions add up to, and which slides
 * produced nothing. It never pads; a shortfall is stated, not hidden.
 */
export function buildCoverageReport(input: CoverageInput): CoverageReport {
  const { target, topics, slides, questions } = input;

  const perTopic = topics.map((topic) => {
    const mcq = zero();
    const saq = zero();
    for (const q of questions) {
      if (q.status !== "active" || q.topicId !== topic.id) continue;
      (q.type === "mcq" ? mcq : saq)[q.difficulty] += 1;
    }
    return {
      topicId: topic.id,
      name: topic.name,
      slideCount: slides.filter((s) => s.topicIds.includes(topic.id)).length,
      mcq,
      saq,
    };
  });

  const count = (pred: (q: CoverageInput["questions"][number]) => boolean) =>
    questions.filter(pred).length;
  const totals = {
    activeMcq: count((q) => q.status === "active" && q.type === "mcq"),
    activeSaq: count((q) => q.status === "active" && q.type === "saq"),
    needsReview: count((q) => q.status === "needs_review"),
    retired: count((q) => q.status === "retired"),
  };

  // A slide counts as covered while any question that is not retired cites it.
  const covered = new Set<string>();
  for (const q of questions) {
    if (q.status === "retired") continue;
    for (const id of q.sourceSlideIds) covered.add(id);
  }
  const skipped = new Set(input.skippedSlideIds ?? []);
  const slidesWithoutQuestions: CoverageReport["slidesWithoutQuestions"] = [];
  for (const slide of slides) {
    if (covered.has(slide.id)) continue;
    const reason =
      slide.legibility === "unreadable"
        ? "unreadable"
        : slide.topicIds.length === 0
          ? "not in any topic"
          : skipped.has(slide.id)
            ? "could not be processed automatically"
            : "no question generated";
    slidesWithoutQuestions.push({ slideId: slide.id, label: slide.label, reason });
  }

  const active = totals.activeMcq + totals.activeSaq;
  const targetMet = active >= target;
  return {
    perTopic,
    totals,
    slidesWithoutQuestions,
    targetMet,
    shortfallNote: targetMet
      ? null
      : `Only ${active} questions could be written from this material without repeating or going beyond the slides (target ${target}). Adding more handouts will increase coverage.`,
  };
}
