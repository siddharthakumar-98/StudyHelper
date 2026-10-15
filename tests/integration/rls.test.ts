import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  anonClient,
  createTestUser,
  resetDb,
  serviceClient,
  signedInClient,
} from "./helpers";

const service = serviceClient();
const STATUSES = ["draft", "needs_review", "active", "flagged", "retired"] as const;

let student: { email: string; password: string; id: string };
let otherStudent: { email: string; password: string; id: string };
let admin: { email: string; password: string; id: string };
let studentClient: SupabaseClient;
let adminClient: SupabaseClient;

async function seedDocument(title = "Seeded handout") {
  const { data, error } = await service
    .from("documents")
    .insert({ title })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

async function seedTopic(name = "Insulin therapy") {
  const { data, error } = await service
    .from("topics")
    .insert({ name })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

async function seedQuestion(
  topicId: string,
  status: (typeof STATUSES)[number],
  withKey = false,
) {
  const { data: q, error } = await service
    .from("questions")
    .insert({ type: "mcq", status, topic_id: topicId, difficulty: "easy" })
    .select()
    .single();
  if (error) throw new Error(error.message);
  const { error: vError } = await service.from("question_versions").insert({
    question_id: q.id,
    version: 1,
    stem: `Stem for ${status}`,
    options: [
      { id: "a", text: "A" },
      { id: "b", text: "B" },
    ],
    source_refs: [],
    basis_quote: "quote",
  });
  if (vError) throw new Error(vError.message);
  if (withKey) {
    const { error: kError } = await service.from("answer_keys").insert({
      question_id: q.id,
      version: 1,
      correct_option_id: "a",
      explanation: "because",
    });
    if (kError) throw new Error(kError.message);
  }
  return q;
}

beforeAll(async () => {
  student = await createTestUser("student");
  otherStudent = await createTestUser("student");
  admin = await createTestUser("admin");
  studentClient = await signedInClient(student.email, student.password);
  adminClient = await signedInClient(admin.email, admin.password);
});

beforeEach(async () => {
  await resetDb();
});

describe("row level security", () => {
  it("anon cannot select documents", async () => {
    await seedDocument();
    const { data, error } = await anonClient().from("documents").select("*");
    expect(error !== null || (data ?? []).length === 0).toBe(true);
  });

  it("student can select documents and topics", async () => {
    await seedDocument();
    await seedTopic();
    const docs = await studentClient.from("documents").select("*");
    const topics = await studentClient.from("topics").select("*");
    expect(docs.error).toBeNull();
    expect(docs.data).toHaveLength(1);
    expect(topics.error).toBeNull();
    expect(topics.data).toHaveLength(1);
  });

  it("student cannot insert documents", async () => {
    const { error } = await studentClient
      .from("documents")
      .insert({ title: "Sneaky" });
    expect(error).not.toBeNull();
  });

  it("student cannot select answer_keys even for active questions", async () => {
    const topic = await seedTopic();
    await seedQuestion(topic.id, "active", true);
    const { data: seeded } = await service.from("answer_keys").select("*");
    expect(seeded).toHaveLength(1);
    const { data, error } = await studentClient.from("answer_keys").select("*");
    expect(error !== null || (data ?? []).length === 0).toBe(true);
    // The revoke is in place: a privilege error (42501), not merely an RLS-empty result.
    expect(error?.code).toBe("42501");
  });

  it("anon cannot select answer_keys", async () => {
    const topic = await seedTopic();
    await seedQuestion(topic.id, "active", true);
    const { data, error } = await anonClient().from("answer_keys").select("*");
    expect(error !== null || (data ?? []).length === 0).toBe(true);
  });

  it("admin cannot select answer_keys through the client either", async () => {
    const topic = await seedTopic();
    await seedQuestion(topic.id, "active", true);
    const { data, error } = await adminClient.from("answer_keys").select("*");
    expect(error !== null || (data ?? []).length === 0).toBe(true);
  });

  it("student cannot insert, update or delete answer_keys", async () => {
    const topic = await seedTopic();
    const q = await seedQuestion(topic.id, "active", true);
    // A version 2 exists, so the composite FK is satisfied: a denial here can
    // only come from privileges/RLS, not from referential integrity.
    const { error: vError } = await service.from("question_versions").insert({
      question_id: q.id,
      version: 2,
      stem: "Second version",
      source_refs: [],
      basis_quote: "quote",
    });
    expect(vError).toBeNull();
    const ins = await studentClient.from("answer_keys").insert({
      question_id: q.id,
      version: 2,
      correct_option_id: "b",
    });
    expect(ins.error).not.toBeNull();
    expect(ins.error!.code).toBe("42501");
    await studentClient
      .from("answer_keys")
      .update({ correct_option_id: "b" })
      .eq("question_id", q.id);
    await studentClient.from("answer_keys").delete().eq("question_id", q.id);
    const { data } = await service
      .from("answer_keys")
      .select("*")
      .eq("question_id", q.id);
    expect(data).toHaveLength(1); // only the service-seeded version 1 key
    expect(data![0].correct_option_id).toBe("a");
  });

  it("student cannot change their own profiles.role", async () => {
    await studentClient
      .from("profiles")
      .update({ role: "admin" })
      .eq("id", student.id);
    const { data } = await service
      .from("profiles")
      .select("role")
      .eq("id", student.id)
      .single();
    expect(data!.role).toBe("student");
  });

  it("student cannot update or delete questions", async () => {
    const topic = await seedTopic();
    const q = await seedQuestion(topic.id, "active");
    await studentClient
      .from("questions")
      .update({ status: "retired" })
      .eq("id", q.id);
    await studentClient.from("questions").delete().eq("id", q.id);
    const { data } = await service
      .from("questions")
      .select("status")
      .eq("id", q.id);
    expect(data).toEqual([{ status: "active" }]);
  });

  it("student sees only active and flagged questions", async () => {
    const topic = await seedTopic();
    for (const status of STATUSES) await seedQuestion(topic.id, status);
    const { data, error } = await studentClient.from("questions").select("*");
    expect(error).toBeNull();
    expect(data).toHaveLength(2);
    expect(data!.map((q) => q.status).sort()).toEqual(["active", "flagged"]);
    const versions = await studentClient.from("question_versions").select("*");
    expect(versions.data).toHaveLength(2);
  });

  it("student can insert own question_flags but not for another user_id", async () => {
    const topic = await seedTopic();
    const q = await seedQuestion(topic.id, "active");
    const own = await studentClient
      .from("question_flags")
      .insert({ question_id: q.id, user_id: student.id, comment: "unclear" });
    expect(own.error).toBeNull();
    const other = await studentClient.from("question_flags").insert({
      question_id: q.id,
      user_id: otherStudent.id,
      comment: "spoofed",
    });
    expect(other.error).not.toBeNull();
    const mine = await studentClient.from("question_flags").select("*");
    expect(mine.data).toHaveLength(1);
  });

  it("admin sees questions in every status", async () => {
    const topic = await seedTopic();
    for (const status of STATUSES) await seedQuestion(topic.id, status);
    const { data, error } = await adminClient.from("questions").select("*");
    expect(error).toBeNull();
    expect(data).toHaveLength(5);
  });

  it("student can read only their own profile", async () => {
    const { data } = await studentClient.from("profiles").select("*");
    expect(data).toHaveLength(1);
    expect(data![0].id).toBe(student.id);
  });

  it("resetDb is not callable by students", async () => {
    const { error } = await studentClient.rpc("test_reset_app_tables");
    expect(error).not.toBeNull();
  });
});
