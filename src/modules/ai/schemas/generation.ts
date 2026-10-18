import { z } from "zod";

// Kept flat and free of numeric limits: structured outputs drop min/max from the
// API schema, so limits (option count, rubric weights) are checked in code by
// validateStructure, where a miss becomes a review note instead of a failed call.

const DifficultySchema = z
  .enum(["easy", "medium", "hard"])
  .describe("easy = recall, medium = application, hard = clinical reasoning");

const SourceFields = {
  difficulty: DifficultySchema,
  source_slide_ids: z
    .array(z.string())
    .describe("The short ids (such as S3) of the slides the question is based on, copied exactly"),
  basis_quote: z
    .string()
    .describe("A passage of at most 300 characters copied character for character from a cited slide"),
  conflict_note: z
    .string()
    .nullable()
    .describe("Names both slides and what each says when the cited slides disagree; otherwise null"),
};

export const RubricSchema = z.object({
  criteria: z.array(
    z.object({
      id: z.string().describe("c1, c2, ..."),
      statement: z.string().describe("One atomic, checkable point a full answer makes"),
      weight: z.number().describe("Marks for this criterion; all weights add up to 5.0"),
      equivalents: z.array(z.string()).describe("Other wordings that earn the same credit"),
      partial_credit_examples: z.array(z.string()),
    }),
  ),
  critical_errors: z.array(
    z.object({
      id: z.string().describe("e1, e2, ..."),
      statement: z.string().describe("A dangerous misconception or unsafe statement"),
    }),
  ),
});

export type Rubric = z.infer<typeof RubricSchema>;

export const GeneratedMcqSchema = z.object({
  stem: z.string(),
  options: z.array(
    z.object({
      id: z.enum(["a", "b", "c", "d"]),
      text: z.string(),
    }),
  ),
  correct_option_id: z.enum(["a", "b", "c", "d"]),
  explanation: z.string().describe("At most 60 words"),
  ...SourceFields,
});

export type GeneratedMcq = z.infer<typeof GeneratedMcqSchema>;

export const GeneratedSaqSchema = z.object({
  stem: z.string(),
  model_answer: z.string().describe("A full-mark answer of 5 to 8 lines"),
  key_concepts: z.array(
    z.object({
      concept: z.string(),
      equivalents: z.array(z.string()),
    }),
  ),
  rubric: RubricSchema,
  ...SourceFields,
});

export type GeneratedSaq = z.infer<typeof GeneratedSaqSchema>;

export const GenerationResultSchema = z.object({
  mcqs: z.array(GeneratedMcqSchema),
  saqs: z.array(GeneratedSaqSchema),
  skipped_slides: z.array(
    z.object({
      slide_id: z.string(),
      reason: z.string(),
    }),
  ),
});

export type GenerationResult = z.infer<typeof GenerationResultSchema>;
