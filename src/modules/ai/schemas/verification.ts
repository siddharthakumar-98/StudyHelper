import { z } from "zod";

export const DedupSchema = z.object({
  duplicate_of_question_id: z
    .string()
    .nullable()
    .describe("The id (such as Q2) of the existing question that tests the same fact; null when none does"),
  reason: z.string().describe("One sentence: the shared fact, or why the facts differ"),
});

export type DedupResult = z.infer<typeof DedupSchema>;

export const VerificationSchema = z.object({
  answer_supported_by_slide: z
    .boolean()
    .describe("True only when the cited slides state the facts the correct answer depends on"),
  single_best_answer_ok: z
    .boolean()
    .nullable()
    .describe("MCQ: true when exactly one option is defensible. Null for an SAQ"),
  rubric_consistent: z
    .boolean()
    .nullable()
    .describe("SAQ: true when the rubric matches the model answer and its weights make sense. Null for an MCQ"),
  ambiguous: z.boolean().describe("True when the stem can reasonably be read in more than one way"),
  stem_gives_away_answer: z.boolean().describe("True when the stem or its wording reveals the answer"),
  guideline_conflict: z
    .string()
    .nullable()
    .describe("What the slide says and what current guidelines say, when they differ; otherwise null"),
  issues: z.array(z.string()).describe("Each problem found, one short sentence each"),
  pass: z.boolean().describe("True only when the question is fit for exam practice"),
});

export type Verification = z.infer<typeof VerificationSchema>;
