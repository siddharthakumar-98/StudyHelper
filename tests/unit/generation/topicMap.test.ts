import { describe, expect, it } from "vitest";
import { buildTopicMap, reconcileTopicMap, slideExcerpt } from "@/modules/generation/topicMap";
import { TOPIC_MAP_PROMPT } from "@/modules/ai/prompts/topicMap";
import { createFakeAiClient, DEFAULT_FAKE_RESPONDERS } from "@/modules/ai/fake";
import type { AiCallInput } from "@/modules/ai/client";

const ids = ["a", "b", "c", "d"];

describe("reconcileTopicMap", () => {
  it("drops unknown slide ids and reports them", () => {
    const result = reconcileTopicMap(
      {
        topics: [{ name: "Insulin", slide_ids: ["a", "ghost"] }],
        unassigned: [{ slide_id: "phantom", reason: "blurry" }],
      },
      ["a"],
      ["a"],
    );
    expect(result.topics).toEqual([{ name: "Insulin", slideIds: ["a"] }]);
    expect(result.unassigned).toEqual([]);
    expect(result.droppedIds.sort()).toEqual(["ghost", "phantom"]);
  });

  it("marks a readable slide the model left out as unassigned", () => {
    const result = reconcileTopicMap(
      {
        topics: [{ name: "Insulin", slide_ids: ["a"] }],
        unassigned: [{ slide_id: "c", reason: "unreadable photo" }],
      },
      ids,
      ["a", "b", "c"],
    );
    expect(result.unassigned).toEqual([
      { slideId: "c", reason: "unreadable photo" },
      { slideId: "b", reason: "not assigned by model" },
    ]);
    // d is unreadable and not listed: it is not invented into the report.
    expect(result.unassigned.map((u) => u.slideId)).not.toContain("d");
  });

  it("keeps only the first 2 topics of a slide", () => {
    const result = reconcileTopicMap(
      {
        topics: [
          { name: "One", slide_ids: ["a", "b"] },
          { name: "Two", slide_ids: ["a"] },
          { name: "Three", slide_ids: ["a", "b"] },
        ],
        unassigned: [],
      },
      ids,
      ["a", "b"],
    );
    expect(result.topics).toEqual([
      { name: "One", slideIds: ["a", "b"] },
      { name: "Two", slideIds: ["a"] },
      { name: "Three", slideIds: ["b"] },
    ]);
  });

  it("removes a topic that ends up empty", () => {
    const result = reconcileTopicMap(
      {
        topics: [
          { name: "Real", slide_ids: ["a"] },
          { name: "Hollow", slide_ids: ["ghost"] },
          { name: "None", slide_ids: [] },
        ],
        unassigned: [],
      },
      ["a"],
      ["a"],
    );
    expect(result.topics.map((t) => t.name)).toEqual(["Real"]);
  });

  it("merges topics whose names differ only by case or spacing", () => {
    const result = reconcileTopicMap(
      {
        topics: [
          { name: "Insulin therapy", slide_ids: ["a"] },
          { name: " insulin THERAPY ", slide_ids: ["a", "b"] },
        ],
        unassigned: [],
      },
      ids,
      ["a", "b"],
    );
    expect(result.topics).toEqual([{ name: "Insulin therapy", slideIds: ["a", "b"] }]);
  });

  it("takes an unreadable slide out of a topic and reports it as unassigned", () => {
    const result = reconcileTopicMap(
      {
        topics: [
          { name: "Insulin", slide_ids: ["a", "d"] },
          { name: "Only unreadable", slide_ids: ["d"] },
        ],
        unassigned: [],
      },
      ids,
      ["a", "b", "c"],
    );
    expect(result.topics).toEqual([{ name: "Insulin", slideIds: ["a"] }]);
    expect(result.unassigned).toContainEqual({ slideId: "d", reason: "unreadable" });
    expect(result.unassigned.filter((u) => u.slideId === "d")).toHaveLength(1);
    expect(result.droppedIds).toEqual([]);
  });

  it("does not list an assigned slide as unassigned", () => {
    const result = reconcileTopicMap(
      {
        topics: [{ name: "Insulin", slide_ids: ["a"] }],
        unassigned: [{ slide_id: "a", reason: "contradiction" }],
      },
      ["a"],
      ["a"],
    );
    expect(result.unassigned).toEqual([]);
  });
});

describe("slideExcerpt", () => {
  const base = { verbatim_text: "", tables: [], diagram_description: null };

  it("cuts long text to 300 characters", () => {
    expect(slideExcerpt({ ...base, verbatim_text: "x".repeat(500) })).toHaveLength(300);
  });

  it("adds table cells and the diagram when the slide text is short", () => {
    const text = slideExcerpt({
      verbatim_text: "Drug doses",
      tables: [{ caption: null, rows: [["Drug", "Dose"], ["Metformin", "500 mg"]] }],
      diagram_description: "Flowchart from A to B",
    });
    expect(text).toContain("Drug doses");
    expect(text).toContain("Metformin | 500 mg");
    expect(text).toContain("Flowchart from A to B");
  });

  it("leaves tables out when the slide text is long enough", () => {
    const text = slideExcerpt({
      verbatim_text: "y".repeat(100),
      tables: [{ caption: null, rows: [["Metformin"]] }],
      diagram_description: null,
    });
    expect(text).toBe("y".repeat(100));
  });
});

describe("buildTopicMap", () => {
  const slides = [
    { id: "uuid-1", label: "Slide 3", title: "Pumps", text: "Closed loop", legibility: "clear" as const },
    { id: "uuid-2", label: "Page 2, photo 1", title: null, text: "", legibility: "unreadable" as const },
  ];

  it("sends short aliases and existing topic names, never slide ids", async () => {
    let seen: AiCallInput<unknown> | undefined;
    const ai = createFakeAiClient({
      topicMap: (input) => {
        seen = input;
        return { topics: [{ name: "Insulin", slide_ids: ["S1"] }], unassigned: [] };
      },
    });
    await buildTopicMap(slides, ["Hypoglycaemia"], ai, "doc-1");
    expect(seen).toMatchObject({
      task: "topicMap",
      promptVersion: "topic-map@2",
      system: TOPIC_MAP_PROMPT.system,
      documentId: "doc-1",
    });
    const text = JSON.stringify(seen!.content);
    expect(text).toContain("id: S1");
    expect(text).toContain("id: S2");
    expect(text).toContain("Slide 3");
    expect(text).toContain("Hypoglycaemia");
    expect(text).not.toContain("uuid-");
    expect(seen!.meta).toEqual({ slideAliases: "S1,S2", readableSlideAliases: "S1" });
  });

  it("maps aliases back to slide ids and leaves an invented alias for reconcile to drop", async () => {
    const ai = createFakeAiClient({
      topicMap: () => ({
        topics: [{ name: "Insulin", slide_ids: ["S1", " S2 ", "S99"] }],
        unassigned: [{ slide_id: "S77", reason: "odd" }],
      }),
    });
    const map = await buildTopicMap(slides, [], ai, "doc-1");
    expect(map).toEqual({
      topics: [{ name: "Insulin", slide_ids: ["uuid-1", "uuid-2", "S99"] }],
      unassigned: [{ slide_id: "S77", reason: "odd" }],
    });
    const result = reconcileTopicMap(map, ["uuid-1", "uuid-2"], ["uuid-1"]);
    expect(result.topics).toEqual([{ name: "Insulin", slideIds: ["uuid-1"] }]);
    expect(result.droppedIds.sort()).toEqual(["S77", "S99"]);
  });

  it("the default fake answers with the aliases it was given", async () => {
    const ai = createFakeAiClient(DEFAULT_FAKE_RESPONDERS);
    const map = await buildTopicMap(slides, [], ai, "doc-1");
    expect(map).toEqual({
      topics: [{ name: "Fixture topic", slide_ids: ["uuid-1"] }],
      unassigned: [{ slide_id: "uuid-2", reason: "unreadable" }],
    });
  });
});

describe("TOPIC_MAP_PROMPT", () => {
  it("carries every topic-map rule", () => {
    const s = TOPIC_MAP_PROMPT.system;
    expect(s).toMatch(/8 to 25 topics/);
    expect(s).toMatch(/verbatim/i);
    expect(s).toMatch(/at most 2 topics/i);
    expect(s).toMatch(/short clinical heading/i);
    expect(s).toMatch(/unreadable/i);
    expect(s).toMatch(/unassigned/i);
    expect(s).toMatch(/S12/);
  });
});
