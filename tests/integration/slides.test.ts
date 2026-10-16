import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createJob } from "@/modules/jobs/engine";
import { SupabaseJobStore } from "@/modules/jobs/store";
import {
  MAX_SLIDE_TEXT_LENGTH,
  latestUnfinishedJobId,
  pageViewUrlFor,
  updateSlideTextRecord,
} from "@/modules/ingestion/slideService";
import { createUploadRecords } from "@/modules/ingestion/uploadService";
import type { Database } from "@/lib/supabase/database.types";
import { createTestUser, resetDb, serviceClient } from "./helpers";
import { makePdf } from "../fixtures/makePdf";

const db = serviceClient() as SupabaseClient<Database>;

async function documentWithOneSlide() {
  const admin = await createTestUser("admin");
  const pdf = await makePdf({ pages: 1 });
  const { documentId } = await createUploadRecords(db, admin.id, {
    title: "Slide service fixture",
    classDate: null,
    files: [{ name: "one.pdf", type: "application/pdf", size: pdf.byteLength }],
  });
  const storagePath = `materials/${documentId}/pages/0001.pdf`;
  const { error: uploadError } = await db.storage
    .from("materials")
    .upload(storagePath, pdf, { contentType: "application/pdf" });
  expect(uploadError).toBeNull();
  const { data: page, error: pageError } = await db
    .from("source_pages")
    .insert({ document_id: documentId, page_no: 1,
      source_file_index: 0,
      kind: "pdf_page",
      storage_path: storagePath,
    })
    .select("id")
    .single();
  expect(pageError).toBeNull();
  const { data: slide, error: slideError } = await db
    .from("source_slides")
    .insert({
      page_id: page!.id,
      position_on_page: 1,
      verbatim_text: "Original text",
      legibility: "clear",
    })
    .select("id")
    .single();
  expect(slideError).toBeNull();
  return { documentId, pageId: page!.id, slideId: slide!.id };
}

describe("slide review services", () => {
  beforeAll(resetDb);

  it("saves a correction and marks the slide corrected", async () => {
    const { slideId } = await documentWithOneSlide();
    await updateSlideTextRecord(db, slideId, "Fixed text");
    const { data } = await db
      .from("source_slides")
      .select("verbatim_text, admin_corrected")
      .eq("id", slideId)
      .single();
    expect(data).toEqual({ verbatim_text: "Fixed text", admin_corrected: true });
  });

  it("rejects non-text, over-long text and unknown slides without changing anything", async () => {
    const { slideId } = await documentWithOneSlide();
    await expect(updateSlideTextRecord(db, slideId, 42)).rejects.toThrow(/must be text/);
    await expect(
      updateSlideTextRecord(db, slideId, "x".repeat(MAX_SLIDE_TEXT_LENGTH + 1)),
    ).rejects.toThrow(/too long/);
    await expect(
      updateSlideTextRecord(db, "00000000-0000-0000-0000-000000000000", "text"),
    ).rejects.toThrow(/not found/);
    const { data } = await db
      .from("source_slides")
      .select("verbatim_text, admin_corrected")
      .eq("id", slideId)
      .single();
    expect(data).toEqual({ verbatim_text: "Original text", admin_corrected: false });
  });

  it("returns a signed URL for a page that serves the file", async () => {
    const { pageId } = await documentWithOneSlide();
    const url = await pageViewUrlFor(db, pageId);
    expect(url).toContain("/object/sign/materials/");
    expect((await fetch(url)).status).toBe(200);
    await expect(pageViewUrlFor(db, "00000000-0000-0000-0000-000000000000")).rejects.toThrow(
      /not found/,
    );
  });

  it("finds the most recent job that is not done", async () => {
    const { documentId } = await documentWithOneSlide();
    expect(await latestUnfinishedJobId(db, documentId)).toBeNull();
    const store = new SupabaseJobStore(db);
    const first = await createJob(store, "split", documentId, {});
    await db.from("jobs").update({ status: "done" }).eq("id", first);
    expect(await latestUnfinishedJobId(db, documentId)).toBeNull();
    const second = await createJob(store, "extract", documentId, {});
    const third = await createJob(store, "topic_map", documentId, {});
    await db.from("jobs").update({ status: "failed" }).eq("id", third);
    expect(await latestUnfinishedJobId(db, documentId)).toBe(third);
    expect(second).not.toBe(third);
  });
});
