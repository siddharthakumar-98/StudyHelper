import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createJob, runJobStep } from "@/modules/jobs/engine";
import type { StepDeps } from "@/modules/jobs/engine";
import { JOB_HANDLERS } from "@/modules/jobs/registry";
import { MemoryJobStore } from "@/modules/jobs/store";
import { createFakeAiClient, DEFAULT_FAKE_RESPONDERS } from "@/modules/ai/fake";
import type { AiCallInput } from "@/modules/ai/client";
import type { Database } from "@/lib/supabase/database.types";
import { createTestUser, resetDb, serviceClient } from "./helpers";

const service = serviceClient();
const db = service as SupabaseClient<Database>;
const fakeDeps: StepDeps = { ai: createFakeAiClient(DEFAULT_FAKE_RESPONDERS), db };

type Legibility = "clear" | "partial" | "unreadable";

/** A document with one page and the given slides (no AI, no storage needed). */
async function documentWithSlides(legibilities: Legibility[]): Promise<{
  documentId: string;
  slideIds: string[];
}> {
  const admin = await createTestUser("admin");
  const { data: doc, error } = await service
    .from("documents")
    .insert({ title: "Topic fixture", uploaded_by: admin.id })
    .select("id")
    .single();
  expect(error).toBeNull();
  const documentId = doc!.id as string;
  const { data: page, error: pageError } = await service
    .from("source_pages")
    .insert({
      document_id: documentId,
      page_no: 1,
      source_file_index: 0,
      kind: "image",
      storage_path: `${documentId}/1.jpg`,
    })
    .select("id")
    .single();
  expect(pageError).toBeNull();
  const { data: slides, error: slideError } = await service
    .from("source_slides")
    .insert(
      legibilities.map((legibility, i) => ({
        page_id: page!.id,
        position_on_page: i + 1,
        printed_slide_no: String(i + 1),
        title: `Slide title ${i + 1}`,
        verbatim_text: `Text of slide ${i + 1}`,
        legibility,
      })),
    )
    .select("id, position_on_page");
  expect(slideError).toBeNull();
  const slideIds = [...slides!]
    .sort((a, b) => a.position_on_page - b.position_on_page)
    .map((s) => s.id as string);
  return { documentId, slideIds };
}

async function runTopicMap(documentId: string, deps: StepDeps = fakeDeps) {
  const store = new MemoryJobStore();
  const jobId = await createJob(store, "topic_map", documentId, {});
  const snapshot = await runJobStep(store, JOB_HANDLERS, jobId, deps);
  return { store, snapshot };
}

async function counts(documentId: string, slideIds: string[]) {
  const [topics, links, runs] = await Promise.all([
    service.from("topics").select("id", { count: "exact", head: true }),
    service.from("slide_topics").select("slide_id", { count: "exact", head: true }).in("slide_id", slideIds),
    service.from("generation_runs").select("id", { count: "exact", head: true }).eq("document_id", documentId),
  ]);
  return { topics: topics.count, links: links.count, runs: runs.count };
}

describe("topic_map stage", () => {
  beforeAll(resetDb);

  it("groups readable slides into a topic and hands the run to generate", async () => {
    const { documentId, slideIds } = await documentWithSlides(["clear", "partial", "unreadable"]);
    const { store, snapshot } = await runTopicMap(documentId);

    expect(snapshot).toMatchObject({ status: "done", error: null });
    const next = await store.get(snapshot.nextJobId!);
    expect(next.kind).toBe("generate");
    const { data: runs } = await service
      .from("generation_runs")
      .select("id, completed_at")
      .eq("document_id", documentId);
    expect(runs).toHaveLength(1);
    expect(next.payload).toEqual({ runId: runs![0].id });
    expect(runs![0].completed_at).toBeNull();

    const { data: links } = await service
      .from("slide_topics")
      .select("slide_id, topics(name)")
      .in("slide_id", slideIds);
    expect(links).toHaveLength(2);
    expect(links!.map((l) => l.slide_id).sort()).toEqual([slideIds[0], slideIds[1]].sort());
    expect(links!.every((l) => (l.topics as unknown as { name: string }).name === "Fixture topic")).toBe(true);
  });

  it("running the stage twice leaves the same topics, links and run", async () => {
    const { documentId, slideIds } = await documentWithSlides(["clear", "clear"]);
    await runTopicMap(documentId);
    const first = await counts(documentId, slideIds);
    const { data: run1 } = await service.from("generation_runs").select("id").eq("document_id", documentId);

    const { snapshot } = await runTopicMap(documentId);
    expect(snapshot).toMatchObject({ status: "done", error: null });
    expect(await counts(documentId, slideIds)).toEqual(first);
    expect(first.links).toBe(2);
    const { data: run2 } = await service.from("generation_runs").select("id").eq("document_id", documentId);
    expect(run2).toEqual(run1);
  });

  it("a second document returning the same name in another case links to the same topic", async () => {
    await resetDb();
    const first = await documentWithSlides(["clear"]);
    await runTopicMap(first.documentId);
    const second = await documentWithSlides(["clear"]);

    let existingSeen: string | undefined;
    const ai = createFakeAiClient({
      topicMap: (input: AiCallInput<unknown>) => {
        existingSeen = JSON.stringify(input.content);
        return {
          topics: [{ name: "fixture topic", slide_ids: ["S1"] }],
          unassigned: [],
        };
      },
    });
    await runTopicMap(second.documentId, { ai, db });

    expect(existingSeen).toContain("Fixture topic");
    const { data: topics } = await service.from("topics").select("id, name");
    expect(topics).toHaveLength(1);
    expect(topics![0].name).toBe("Fixture topic"); // first-seen casing kept
    const { data: links } = await service
      .from("slide_topics")
      .select("topic_id, slide_id")
      .in("slide_id", [first.slideIds[0], second.slideIds[0]]);
    expect(links).toHaveLength(2);
    expect(new Set(links!.map((l) => l.topic_id))).toEqual(new Set([topics![0].id]));
  });

  it("re-running with a different map replaces this document's links only", async () => {
    await resetDb();
    const a = await documentWithSlides(["clear"]);
    const b = await documentWithSlides(["clear"]);
    await runTopicMap(a.documentId);
    await runTopicMap(b.documentId);

    const ai = createFakeAiClient({
      topicMap: () => ({ topics: [{ name: "Other topic", slide_ids: ["S1"] }], unassigned: [] }),
    });
    await runTopicMap(a.documentId, { ai, db });

    const { data: links } = await service
      .from("slide_topics")
      .select("slide_id, topics(name)")
      .in("slide_id", [a.slideIds[0], b.slideIds[0]]);
    const byName = Object.fromEntries(
      links!.map((l) => [l.slide_id, (l.topics as unknown as { name: string }).name]),
    );
    expect(byName).toEqual({ [a.slideIds[0]]: "Other topic", [b.slideIds[0]]: "Fixture topic" });
  });

  it("a model answer with unknown aliases or ids never reaches the database", async () => {
    await resetDb();
    const { documentId, slideIds } = await documentWithSlides(["clear", "clear"]);
    const ai = createFakeAiClient({
      topicMap: () => ({
        topics: [{ name: "Insulin", slide_ids: ["S1", "S9", "00000000-0000-0000-0000-000000000000"] }],
        unassigned: [],
      }),
    });
    const { snapshot } = await runTopicMap(documentId, { ai, db });
    expect(snapshot).toMatchObject({ status: "done", error: null });
    const { data: links } = await service.from("slide_topics").select("slide_id").in("slide_id", slideIds);
    expect(links).toEqual([{ slide_id: slideIds[0] }]);
  });

  it("never links an unreadable slide the model put in a topic", async () => {
    await resetDb();
    const { documentId, slideIds } = await documentWithSlides(["clear", "unreadable"]);
    const ai = createFakeAiClient({
      topicMap: () => ({ topics: [{ name: "Insulin", slide_ids: ["S1", "S2"] }], unassigned: [] }),
    });
    const { snapshot } = await runTopicMap(documentId, { ai, db });
    expect(snapshot).toMatchObject({ status: "done", error: null });
    const { data: links } = await service.from("slide_topics").select("slide_id").in("slide_id", slideIds);
    expect(links).toEqual([{ slide_id: slideIds[0] }]);
  });
});
