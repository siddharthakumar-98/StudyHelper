import { describe, expect, it } from "vitest";
import { buildTopicMap, reconcileTopicMap, slideExcerpt } from "@/modules/generation/topicMap";
import { TOPIC_MAP_PROMPT } from "@/modules/ai/prompts/topicMap";
import { createFakeAiClient } from "@/modules/ai/fake";
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
  it("sends slide ids and existing topic names, and returns the model's map", async () => {
    let seen: AiCallInput<unknown> | undefined;
    const ai = createFakeAiClient({
      topicMap: (input) => {
        seen = input;
        return { topics: [{ name: "Insulin", slide_ids: ["s1"] }], unassigned: [] };
      },
    });
    const map = await buildTopicMap(
      [{ id: "s1", label: "Slide 3", title: "Pumps", text: "Closed loop", legibility: "clear" }],
      ["Hypoglycaemia"],
      ai,
      "doc-1",
    );
    expect(map.topics[0].name).toBe("Insulin");
    expect(seen).toMatchObject({
      task: "topicMap",
      promptVersion: "topic-map@1",
      system: TOPIC_MAP_PROMPT.system,
      documentId: "doc-1",
    });
    const text = JSON.stringify(seen!.content);
    expect(text).toContain("s1");
    expect(text).toContain("Slide 3");
    expect(text).toContain("Hypoglycaemia");
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
  });
});
