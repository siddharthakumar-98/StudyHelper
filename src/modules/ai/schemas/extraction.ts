import { z } from "zod";

export const ExtractedSlideSchema = z.object({
  position_on_page: z
    .number()
    .int()
    .describe("Order of the slide photo on the page, top to bottom, starting at 1"),
  printed_slide_no: z
    .string()
    .nullable()
    .describe("The slide number exactly as printed on the slide, or null if none is visible"),
  title: z.string().nullable(),
  verbatim_text: z.string(),
  tables: z.array(
    z.object({
      caption: z.string().nullable(),
      rows: z.array(z.array(z.string())),
    }),
  ),
  diagram_description: z.string().nullable(),
  legibility: z.enum(["clear", "partial", "unreadable"]),
  uncertain_terms: z.array(z.string()),
  cropped: z.boolean(),
});

export type ExtractedSlide = z.infer<typeof ExtractedSlideSchema>;

export const ExtractionResultSchema = z.object({ slides: z.array(ExtractedSlideSchema) });

export type ExtractionResult = z.infer<typeof ExtractionResultSchema>;
