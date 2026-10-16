import { describe, expect, it } from "vitest";
import {
  generateForTopic,
  planTopicBatches,
  targetsFor,
  type SlideForGeneration,
} from "@/modules/generation/generate";
import { validateGenerated } from "@/modules/generation/validate";
import { GENERATE_QUESTIONS_PROMPT } from "@/modules/ai/prompts/generateQuestions";
import { createFakeAiClient, DEFAULT_FAKE_RESPONDERS } from "@/modules/ai/fake";
import type { AiCallInput } from "@/modules/ai/client";

const DOC_ID = "ab12cd34-0000-4000-8000-000000000000";

function slide(n: number, overrides: Partial<SlideForGeneration> = {}): SlideForGeneration {
  return {
    id: `slide-${n}`,
    label: `Slide ${n}`,
    pageId: `page-${n}`,
    title: `Title ${n}`,
    verbatim_text: `Text of slide ${n}. Metformin 500 mg.`,
    tables: [],
    diagram_description: null,
    ...overrides,
  };
}

const PDF = new TextEncoder().encode("%PDF-1.7 fake page");
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);

const emptyResult = { mcqs: [], saqs: [], skipped_slides: [] };

/** A fake AI that records every call and answers with `answer`. */
function recordingAi(answer: (input: AiCallInput<unknown>) => unknown = () => emptyResult) {
  const calls: AiCallInput<unknown>[] = [];
  const ai = createFakeAiClient({
    generate: (input) => {
      calls.push(input);
      return answer(input);
    },
  });
  return { ai, calls };
}

const textOf = (input: AiCallInput<unknown>) =>
  input.content
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("\n");

function mcqCiting(ids: string[], quote = "Metformin 500 mg") {
  return {
    stem: "Which dose is on the slide?",
    options: [
      { id: "a", text: "500 mg" },
      { id: "b", text: "850 mg" },
      { id: "c", text: "1000 mg" },
      { id: "d", text: "2000 mg" },
    ],
    correct_option_id: "a",
    explanation: "The slide says 500 mg.",
    difficulty: "easy",
    source_slide_ids: ids,
    basis_quote: quote,
    conflict_note: null,
  };
}

const baseInput = (slides: SlideForGeneration[], pageDocs = new Map<string, Uint8Array>()) => ({
  topicName: "Metformin",
  slides,
  pageDocs,
  avoidStems: [] as string[],
  maxMcq: 2,
  maxSaq: 1,
});

describe("targetsFor", () => {
  it("allows up to 0.9 MCQs and 0.4 SAQs per slide, rounded up", () => {
    expect(targetsFor(1)).toEqual({ maxMcq: 1, maxSaq: 1 });
    expect(targetsFor(7)).toEqual({ maxMcq: 7, maxSaq: 3 });
  });
});

describe("planTopicBatches", () => {
  it("splits a topic into batches of at most 6 slides, in order", () => {
    const slides = Array.from({ length: 13 }, (_, i) => slide(i + 1));
    const batches = planTopicBatches(slides);
    expect(batches.map((b) => b.length)).toEqual([6, 6, 1]);
    expect(batches.flat()).toEqual(slides);
  });

  it("returns no batches for no slides", () => {
    expect(planTopicBatches([])).toEqual([]);
  });
});

describe("GENERATE_QUESTIONS_PROMPT", () => {
  it("is versioned and carries the core rules", () => {
    expect(GENERATE_QUESTIONS_PROMPT.version).toBe("generate-questions@2");
    const system = GENERATE_QUESTIONS_PROMPT.system;
    for (const rule of [
      "Fellowship Certification in Diabetology",
      "mg/dL",
      "basis_quote",
      "300 characters",
      "all of the above",
      "60 words",
      "5–8 lines",
      "5.0",
      "equivalents",
      "critical_errors",
      "conflict_note",
      "avoid_stems",
      "skipped_slides",
      "Never exceed",
      // Every contradiction is surfaced: guidelines, other slides of the topic, a slide's own picture.
      "You must write a \"conflict_note\"",
      "Other slides in this topic",
      "never cite them",
      "its own table, diagram description or page photo",
      // Self-contained stems and scenarios that add no new facts.
      "Never refer to \"the slide\"",
      "Never introduce clinical facts, drug doses, thresholds",
    ]) {
      expect(system).toContain(rule);
    }
  });
});

describe("generateForTopic", () => {
  it("sends short slide ids, labels, maxima and stems to avoid, never slide ids", async () => {
    const { ai, calls } = recordingAi();
    await generateForTopic(
      {
        ...baseInput([slide(1), slide(2, { tables: [{ caption: null, rows: [["Drug", "Dose"], ["Metformin", "500 mg"]] }] })]),
        avoidStems: ["What is the maximum dose of metformin?"],
      },
      ai,
      DOC_ID,
    );
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call.task).toBe("generate");
    expect(call.promptVersion).toBe("generate-questions@2");
    expect(call.system).toBe(GENERATE_QUESTIONS_PROMPT.system);
    expect(call.documentId).toBe(DOC_ID);
    const text = textOf(call);
    expect(text).toContain("Metformin");
    expect(text).toContain("[S1] Slide 1");
    expect(text).toContain("[S2] Slide 2");
    expect(text).toContain("Metformin | 500 mg");
    expect(text).toContain("at most 2 MCQs");
    expect(text).toContain("at most 1 SAQ");
    expect(text).toContain("What is the maximum dose of metformin?");
    expect(text).not.toContain("slide-1");
    expect(text).not.toContain("Other slides in this topic");
  });

  it("shows the topic's other slides as a read-only block with non-citable refs", async () => {
    const { ai, calls } = recordingAi();
    const other = slide(86, {
      title: "Insulin ratios",
      verbatim_text: "C:I ratio = 450/TDD\nCorrection factor = 2000/TDD " + "x".repeat(400),
    });
    await generateForTopic(
      { ...baseInput([slide(41)]), contextSlides: [other, slide(87, { verbatim_text: "" })] },
      ai,
      DOC_ID,
    );
    const text = textOf(calls[0]);
    const block = text.slice(text.indexOf("Other slides in this topic (context only, never cite or quote these):"));
    expect(block).not.toBe(text);
    expect(block).toContain("(C1) Slide 86\nTitle: Insulin ratios\nExcerpt: C:I ratio = 450/TDD / Correction factor = 2000/TDD");
    expect(block).toContain("(C2) Slide 87");
    expect(block).not.toContain("x".repeat(300)); // excerpts stay short
    expect(block).not.toContain("[S");
    expect(text).not.toContain("slide-86");
    expect(text.indexOf("[S1] Slide 41")).toBeLessThan(text.indexOf("(C1) Slide 86"));
  });

  it("a question citing a context-only slide fails the pre-check", async () => {
    const { ai } = recordingAi(() => ({
      mcqs: [mcqCiting(["C1"], "C:I ratio = 450/TDD")],
      saqs: [],
      skipped_slides: [],
    }));
    const batch = [slide(41)];
    const other = slide(86, { verbatim_text: "C:I ratio = 450/TDD" });
    const result = await generateForTopic({ ...baseInput(batch), contextSlides: [other] }, ai, DOC_ID);
    expect(result.mcqs[0].source_slide_ids).toEqual(["C1"]);
    expect(validateGenerated(result.mcqs[0], new Map(batch.map((s) => [s.id, s])))).toEqual([
      "Cites a slide outside this topic",
      "Basis quote not found in cited slide",
    ]);
  });

  it("maps short ids back to slide ids and leaves an unknown id for the pre-check", async () => {
    const { ai } = recordingAi(() => ({
      mcqs: [mcqCiting(["S2", "s1 ", "S9"])],
      saqs: [],
      skipped_slides: [{ slide_id: "S1", reason: "title slide" }],
    }));
    const result = await generateForTopic(baseInput([slide(1), slide(2)]), ai, DOC_ID);
    expect(result.mcqs[0].source_slide_ids).toEqual(["slide-2", "slide-1", "S9"]);
    expect(result.skipped_slides).toEqual([{ slide_id: "slide-1", reason: "title slide" }]);
  });

  it("drops questions beyond the maxima", async () => {
    const { ai } = recordingAi(() => ({
      mcqs: [mcqCiting(["S1"]), mcqCiting(["S1"]), mcqCiting(["S1"])],
      saqs: [],
      skipped_slides: [],
    }));
    const result = await generateForTopic(baseInput([slide(1)]), ai, DOC_ID);
    expect(result.mcqs).toHaveLength(2);
  });

  it("attaches one page document per page for slides with tables or long diagrams", async () => {
    const table = [{ caption: null, rows: [["a", "b"]] }];
    const slides = [
      slide(1, { pageId: "p-pdf", tables: table }),
      slide(2, { pageId: "p-pdf", diagram_description: "x".repeat(201) }),
      slide(3, { pageId: "p-jpg", tables: table }),
      slide(4, { pageId: "p-png", diagram_description: "y".repeat(201) }),
      slide(5, { pageId: "p-short", diagram_description: "short diagram" }),
      slide(6, { pageId: "p-plain" }),
    ];
    const pageDocs = new Map([
      ["p-pdf", PDF],
      ["p-jpg", JPEG],
      ["p-png", PNG],
      ["p-short", PDF],
      ["p-plain", PDF],
    ]);
    const { ai, calls } = recordingAi();
    await generateForTopic(baseInput(slides, pageDocs), ai, DOC_ID);
    const blocks = calls[0].content.filter((b) => b.type !== "text");
    expect(blocks).toEqual([
      {
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: Buffer.from(PDF).toString("base64") },
      },
      { type: "image", source: { type: "base64", media_type: "image/jpeg", data: Buffer.from(JPEG).toString("base64") } },
      { type: "image", source: { type: "base64", media_type: "image/png", data: Buffer.from(PNG).toString("base64") } },
    ]);
    const text = textOf(calls[0]);
    expect(text).toContain("Page photo for S1, S2");
    expect(text).toContain("Page photo for S3");
  });

  it("the default fake writes one MCQ and one SAQ that pass the pre-checks", async () => {
    const ai = createFakeAiClient(DEFAULT_FAKE_RESPONDERS);
    const slides = [slide(1), slide(2)];
    const result = await generateForTopic(
      { ...baseInput(slides), topicName: "Fixture topic", batchIndex: 3 },
      ai,
      DOC_ID,
    );
    expect(result.mcqs).toHaveLength(1);
    expect(result.saqs).toHaveLength(1);
    const inBatch = new Map(slides.map((s) => [s.id, s]));
    for (const q of [...result.mcqs, ...result.saqs]) {
      expect(q.stem).toContain("[doc ab12cd34]");
      expect(q.stem).toContain("Fixture topic");
      expect(q.stem).toContain("batch 3");
      expect(q.stem).not.toMatch(/\bslide\b/i); // stems are self-contained
      expect(validateGenerated(q, inBatch)).toEqual([]);
    }
  });
});
