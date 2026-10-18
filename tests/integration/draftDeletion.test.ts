import { beforeEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import { resetDb, serviceClient } from "./helpers";

// Item 9: the generate stage's delete paths remove only drafts it wrote itself
// (version 1). A question being regenerated is a draft at version 2 or later in
// the same run and batch; deleting it would destroy its history.

const db = serviceClient() as SupabaseClient<Database>;

const item = (stem: string): Record<string, Json> => ({
  type: "mcq",
  difficulty: "easy",
  stem,
  options: [
    { id: "a", text: "500/TDD" },
    { id: "b", text: "1650/TDD" },
  ],
  source_refs: [],
  basis_quote: "500/TDD",
  conflict_note: null,
  review_notes: [],
  correct_option_id: "a",
  explanation: "e",
  model_answer: null,
  key_concepts: null,
  rubric: null,
});

async function fixture() {
  const { data: doc } = await db.from("documents").insert({ title: "Draft deletion" }).select("id").single();
  const { data: topic } = await db.from("topics").insert({ name: "Insulin" }).select("id").single();
  const { data: run } = await db.from("generation_runs").insert({ document_id: doc!.id }).select("id").single();
  const runId = run!.id as string;
  const topicId = topic!.id as string;
  const save = async (batchKey: string, stems: string[]) => {
    const { error } = await db.rpc("save_generated_questions", {
      p_run_id: runId,
      p_topic_id: topicId,
      p_batch_key: batchKey,
      p_items: stems.map(item),
    });
    expect(error).toBeNull();
  };
  /** A question of `batchKey` that an admin is regenerating: a draft at version 2. */
  const regenerating = async (batchKey: string) => {
    await save(batchKey, ["Original stem"]);
    const { data: q } = await db.from("questions").select("id").eq("batch_key", batchKey).single();
    await db.from("questions").update({ status: "active" }).eq("id", q!.id);
    const { error } = await db.rpc("create_question_version", {
      p_question_id: q!.id,
      p_version: { stem: "Regenerated stem", options: item("x").options, source_refs: [], basis_quote: "500/TDD", conflict_note: null, review_notes: [] },
      p_key: { correct_option_id: "a", explanation: "e", model_answer: null, key_concepts: null, rubric: null },
      p_status: "draft",
      p_expected_version: 1,
    });
    expect(error).toBeNull();
    return q!.id as string;
  };
  const versions = async (id: string) => {
    const { data } = await db.from("question_versions").select("version").eq("question_id", id).order("version");
    return (data ?? []).map((v) => v.version);
  };
  return { runId, save, regenerating, versions };
}

describe("draft deletion keeps regenerating questions (item 9)", () => {
  beforeEach(resetDb);

  it("save_generated_questions replaces the batch's own drafts but not a version-2 draft", async () => {
    const f = await fixture();
    const kept = await f.regenerating("t:0");
    await f.save("t:0", ["New draft A", "New draft B"]);
    await f.save("t:0", ["New draft C"]);

    expect(await f.versions(kept)).toEqual([1, 2]);
    const { data } = await db.from("questions").select("id, current_version").eq("batch_key", "t:0").order("created_at");
    expect(data!.map((q) => q.current_version)).toEqual([2, 1]);
  });

  it("delete_stale_draft_batches removes stale version-1 drafts but not a version-2 draft", async () => {
    const f = await fixture();
    const kept = await f.regenerating("t:0");
    await f.save("t:1", ["Stale draft"]);
    const { data: deleted, error } = await db.rpc("delete_stale_draft_batches", {
      p_run_id: f.runId,
      p_keep_batch_keys: [],
    });
    expect(error).toBeNull();
    expect(deleted).toBe(1);
    expect(await f.versions(kept)).toEqual([1, 2]);
  });
});
