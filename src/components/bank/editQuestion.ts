import type { Difficulty } from "./bankView";

// The edit form's state, and how it becomes the QuestionEdit the server action takes.
// Pure (no server imports) so it can be unit tested and used by the client form.

export type OptionId = "a" | "b" | "c" | "d";
export const OPTION_IDS: OptionId[] = ["a", "b", "c", "d"];

export type McqForm = {
  stem: string;
  difficulty: Difficulty;
  options: { id: string; text: string }[];
  correctOptionId: string;
  explanation: string;
};

export type SaqForm = {
  stem: string;
  difficulty: Difficulty;
  modelAnswer: string;
  keyConcepts: { concept: string; equivalents: string }[];
  criteria: {
    id: string;
    statement: string;
    weight: string;
    equivalents: string[];
    partialCreditExamples: string[];
  }[];
  criticalErrors: { id: string; statement: string }[];
};

export type EditPayload = {
  stem: string;
  difficulty: Difficulty;
  options?: { id: string; text: string }[];
  correctOptionId?: string;
  explanation?: string;
  modelAnswer?: string;
  keyConcepts?: { concept: string; equivalents: string[] }[];
  rubric?: {
    criteria: {
      id: string;
      statement: string;
      weight: number;
      equivalents: string[];
      partial_credit_examples: string[];
    }[];
    critical_errors: { id: string; statement: string }[];
  };
};

export type BuildResult = { ok: true; edit: EditPayload } | { ok: false; issues: string[] };

type LoadedRubric = NonNullable<EditPayload["rubric"]>;

export function mcqFormFrom(q: {
  stem: string;
  difficulty: Difficulty;
  options: { id: string; text: string }[] | null;
  key: { correctOptionId: string | null; explanation: string | null };
}): McqForm {
  return {
    stem: q.stem,
    difficulty: q.difficulty,
    options: OPTION_IDS.map((id) => ({
      id,
      text: q.options?.find((o) => o.id === id)?.text ?? "",
    })),
    correctOptionId: q.key.correctOptionId ?? "a",
    explanation: q.key.explanation ?? "",
  };
}

export function saqFormFrom(q: {
  stem: string;
  difficulty: Difficulty;
  key: {
    modelAnswer: string | null;
    keyConcepts: { concept: string; equivalents: string[] }[] | null;
    rubric: LoadedRubric | null;
  };
}): SaqForm {
  return {
    stem: q.stem,
    difficulty: q.difficulty,
    modelAnswer: q.key.modelAnswer ?? "",
    keyConcepts: (q.key.keyConcepts ?? []).map((k) => ({
      concept: k.concept,
      equivalents: k.equivalents.join(", "),
    })),
    criteria: (q.key.rubric?.criteria ?? []).map((c) => ({
      id: c.id,
      statement: c.statement,
      weight: String(c.weight),
      equivalents: c.equivalents,
      partialCreditExamples: c.partial_credit_examples,
    })),
    criticalErrors: (q.key.rubric?.critical_errors ?? []).map((e) => ({ ...e })),
  };
}

/** Checks what only the browser can (a blank stem, a weight that is not a number); the server checks the rest. */
export function buildQuestionEdit(
  type: "mcq" | "saq" | "essay",
  form: McqForm | SaqForm,
): BuildResult {
  if (type === "essay") return { ok: false, issues: ["Essay questions cannot be edited here"] };
  const stem = form.stem.trim();
  if (!stem) return { ok: false, issues: ["Write the question text"] };

  if (type === "mcq") {
    const f = form as McqForm;
    return {
      ok: true,
      edit: {
        stem,
        difficulty: f.difficulty,
        options: f.options.map((o) => ({ id: o.id, text: o.text.trim() })),
        correctOptionId: f.correctOptionId,
        explanation: f.explanation.trim(),
      },
    };
  }

  const f = form as SaqForm;
  const issues: string[] = [];
  const criteria = f.criteria.map((c) => {
    const text = c.weight.trim();
    const weight = text === "" ? Number.NaN : Number(text);
    if (!Number.isFinite(weight)) issues.push(`The weight for "${c.statement}" must be a number`);
    return {
      id: c.id,
      statement: c.statement.trim(),
      weight,
      equivalents: c.equivalents,
      partial_credit_examples: c.partialCreditExamples,
    };
  });
  if (issues.length > 0) return { ok: false, issues };
  return {
    ok: true,
    edit: {
      stem,
      difficulty: f.difficulty,
      modelAnswer: f.modelAnswer.trim(),
      keyConcepts: f.keyConcepts.map((k) => ({
        concept: k.concept.trim(),
        equivalents: k.equivalents
          .split(",")
          .map((e) => e.trim())
          .filter(Boolean),
      })),
      rubric: {
        criteria,
        critical_errors: f.criticalErrors.map((e) => ({ id: e.id, statement: e.statement.trim() })),
      },
    },
  };
}
