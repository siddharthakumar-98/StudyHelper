import { z } from "zod";

export const TopicMapSchema = z.object({
  topics: z.array(
    z.object({
      name: z.string().describe("Short clinical heading, or an existing topic name copied verbatim"),
      slide_ids: z.array(z.string()).describe("The short ids (such as S12) of the slides under this topic, copied exactly"),
    }),
  ),
  unassigned: z.array(
    z.object({
      slide_id: z.string(),
      reason: z.string(),
    }),
  ),
});

export type TopicMap = z.infer<typeof TopicMapSchema>;
