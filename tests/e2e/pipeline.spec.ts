import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import { loginAs } from "./helpers";
import { makePdf } from "../fixtures/makePdf";

// AI_FAKE=1 (set by the Playwright web server): one clear slide per page, one topic
// ("Fixture topic"), one generation batch (1 MCQ + 1 SAQ), both verified active.

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

const STAGES = [
  "Splitting pages",
  "Reading slides",
  "Finding topics",
  "Writing questions",
  "Checking questions",
];

test.describe("pipeline", () => {
  test.describe.configure({ timeout: 180_000 });

  test("a 2-page handout runs every stage and ends in an honest coverage report", async ({
    page,
  }) => {
    // Record every stage heading the progress panel shows, before the page loads.
    await page.addInitScript((stages: string[]) => {
      const seen: string[] = [];
      (window as unknown as { __stages: string[] }).__stages = seen;
      const look = () => {
        const heading = document.querySelector('section[aria-label="Progress"] h2');
        const text = heading?.textContent ?? "";
        if (stages.includes(text) && !seen.includes(text)) seen.push(text);
      };
      new MutationObserver(look).observe(document, {
        subtree: true,
        childList: true,
        characterData: true,
      });
    }, STAGES);

    await loginAs(page, "admin");
    await page.goto("/materials");
    await page.locator('form[data-hydrated="true"]').waitFor();
    await page.getByLabel("Title").fill("Coverage handout");
    await page.getByLabel("Pages (PDF or photos)").setInputFiles([
      {
        name: "two.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from(await makePdf({ pages: 2 })),
      },
    ]);
    await page.getByRole("button", { name: "Add handout" }).click();
    await expect(page).toHaveURL(/\/materials\/[0-9a-f-]{36}\?job=/, { timeout: 90_000 });

    // Reading stops for the slide check (R38); the admin starts question writing.
    const next = page.getByRole("region", { name: "Next step" });
    await expect(next.getByRole("heading", { name: "Slides are ready to check" })).toBeVisible({
      timeout: 90_000,
    });
    await expect(page.getByRole("article")).toHaveCount(2);
    await page.locator('section[aria-label="Next step"][data-hydrated="true"]').waitFor();
    await next.getByRole("button", { name: "Write questions" }).click();

    // No reload: the page converges by itself when the last stage finishes.
    const report = page.getByRole("region", { name: "Coverage report" });
    await expect(report).toBeVisible({ timeout: 120_000 });
    await expect(report.getByRole("heading", { name: "Coverage report" })).toBeVisible();
    await expect(report.getByText("2 active questions")).toBeVisible();
    await expect(report.getByText("1 multiple choice, 1 short answer", { exact: false })).toBeVisible();
    await expect(report.getByText("0 need review · 0 retired")).toBeVisible();
    await expect(
      report.getByText(
        "Only 2 questions could be written from this material without repeating or going beyond the slides (target 100). Adding more handouts will increase coverage.",
      ),
    ).toBeVisible();

    // One topic.
    const row = report.getByRole("row", { name: /^Fixture topic/ });
    await expect(row).toBeVisible();
    await expect(report.getByRole("row")).toHaveCount(3); // two header rows + one topic
    // The fake writes both questions from slide 1, so slide 2 is honestly listed.
    const uncovered = report.getByRole("list", { name: "Slides without questions" });
    await expect(uncovered.getByRole("listitem")).toHaveCount(1);
    await expect(uncovered.getByRole("listitem")).toContainText("Slide 2 · page 2");
    await expect(uncovered.getByRole("listitem")).toContainText(
      "No question could be written from it",
    );

    // The progress panel went through every stage on the way.
    const seen = await page.evaluate(() => (window as unknown as { __stages: string[] }).__stages);
    expect(seen).toEqual(STAGES);
  });

  test.describe("slide check pause", () => {
    let docId: string;
    const service = serviceClient();

    test.beforeEach(async () => {
      const { data, error } = await service
        .from("documents")
        .insert({ title: "Paused handout", status: "review", page_count: 0 })
        .select("id")
        .single();
      expect(error).toBeNull();
      docId = data!.id;
    });

    test.afterEach(async () => {
      await service.from("documents").delete().eq("id", docId);
    });

    test("students are told the slides are being checked; admins get the Write questions button", async ({
      page,
      browser,
    }) => {
      const student = await browser.newContext();
      const studentPage = await student.newPage();
      await loginAs(studentPage, "student");
      await studentPage.goto(`/materials/${docId}`);
      await expect(
        studentPage.getByText("Slides are being checked before questions are written."),
      ).toBeVisible();
      await expect(studentPage.getByRole("button", { name: "Write questions" })).toHaveCount(0);
      await student.close();

      await loginAs(page, "admin");
      await page.goto(`/materials/${docId}`);
      const button = page.getByRole("region", { name: "Next step" }).getByRole("button", {
        name: "Write questions",
      });
      await expect(button).toBeVisible();
      const box = await button.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(48);
      expect(box!.width).toBeGreaterThanOrEqual(48);
    });
  });

  test.describe("admin progress panel", () => {
    let docId: string;
    const service = serviceClient();

    test.beforeEach(async () => {
      const { data, error } = await service
        .from("documents")
        .insert({ title: "Progress handout", status: "processing", page_count: 0 })
        .select("id")
        .single();
      expect(error).toBeNull();
      docId = data!.id;
    });

    test.afterEach(async () => {
      // Jobs go with the document (cascade).
      await service.from("documents").delete().eq("id", docId);
    });

    test("a running job shows its stage and a progress bar", async ({ page }) => {
      // Held by another runner (lock in the future), so the page only reports it.
      const { error } = await service.from("jobs").insert({
        kind: "verify",
        document_id: docId,
        status: "running",
        locked_until: new Date(Date.now() + 10 * 60_000).toISOString(),
        progress: { current: 3, total: 6, label: "Checked 3 of 6 questions" },
      });
      expect(error).toBeNull();

      await loginAs(page, "admin");
      await page.goto(`/materials/${docId}`);

      const panel = page.getByRole("region", { name: "Progress" });
      await expect(panel.getByRole("heading", { name: "Checking questions" })).toBeVisible({
        timeout: 30_000,
      });
      const bar = panel.getByRole("progressbar", { name: "Checking questions" });
      await expect(bar).toHaveAttribute("aria-valuenow", "50");
      await expect(panel.getByText("Checked 3 of 6 questions")).toBeVisible();
      await expect(panel.getByRole("button", { name: "Try again" })).toHaveCount(0);
    });

    test("a failed job shows the error and a Try again button", async ({ page }) => {
      const { error } = await service.from("jobs").insert({
        kind: "generate",
        document_id: docId,
        status: "failed",
        error: "The question writer returned an incomplete answer.",
        progress: { current: 1, total: 4, label: "Wrote 1 of 4 batches" },
      });
      expect(error).toBeNull();

      await loginAs(page, "admin");
      await page.goto(`/materials/${docId}`);

      const panel = page.getByRole("region", { name: "Progress" });
      await expect(panel.getByRole("heading", { name: "Writing questions" })).toBeVisible({
        timeout: 30_000,
      });
      await expect(
        panel.getByText("The question writer returned an incomplete answer."),
      ).toBeVisible();
      const retry = panel.getByRole("button", { name: "Try again" });
      await expect(retry).toBeVisible();
      const box = await retry.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(48);
      expect(box!.width).toBeGreaterThanOrEqual(48);
    });
  });
});
