import { expect, test, type Page } from "@playwright/test";
import { loginAs } from "./helpers";
import { makePdf } from "../fixtures/makePdf";

// AI_FAKE=1 (set by the Playwright web server): one clear slide per page. Reading
// pauses for the admin's slide check (R38); after "Write questions" the pipeline
// runs through verify with the fakes, so the handout ends "Ready".

async function uploadTwoPageHandout(page: Page, title: string): Promise<string> {
  await page.goto("/materials");
  await page.locator('form[data-hydrated="true"]').waitFor();
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Pages (PDF or photos)").setInputFiles([
    {
      name: "two.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from(await makePdf({ pages: 2 })),
    },
  ]);
  await page.getByRole("button", { name: "Add handout" }).click();
  // Wait for the final URL: the form pushes ?job=... and a later goto must not race it.
  await expect(page).toHaveURL(/\/materials\/[0-9a-f-]{36}\?job=/, { timeout: 90_000 });
  return new URL(page.url()).pathname;
}

/**
 * Opens the handout in a fresh tab and closes the upload tab. The upload tab keeps
 * driving the pipeline and calls router.refresh() as each stage ends, which would
 * interrupt a goto issued from it ("interrupted by another navigation").
 */
async function reopen(page: Page, docPath: string): Promise<Page> {
  const fresh = await page.context().newPage();
  await fresh.goto(docPath);
  await page.close();
  return fresh;
}

const card = (page: Page, n: number) =>
  page.getByRole("article", { name: new RegExp(`^Slide ${n}\\b`) });

/** Clicks "Write questions" once the slides wait for their check (R38). */
async function writeQuestions(page: Page) {
  const panel = page.getByRole("region", { name: "Next step" });
  await expect(panel.getByRole("heading", { name: "Slides are ready to check" })).toBeVisible({
    timeout: 90_000,
  });
  await page.locator('section[aria-label="Next step"][data-hydrated="true"]').waitFor();
  await panel.getByRole("button", { name: "Write questions" }).click();
}

test.describe("slide review", () => {
  test.describe.configure({ timeout: 180_000 });

  test("admin reviews and corrects slides, student reads them", async ({ page, browser }) => {
    await loginAs(page, "admin");
    const docPath = await uploadTwoPageHandout(page, "Slide review handout");

    await expect(card(page, 1)).toBeVisible({ timeout: 90_000 });
    await expect(card(page, 2)).toBeVisible();
    await expect(page.getByRole("article")).toHaveCount(2);
    await expect(card(page, 1)).toContainText("page 1");
    await expect(card(page, 2)).toContainText("page 2");
    await expect(card(page, 1).getByText("Clear", { exact: true })).toBeVisible();
    await expect(card(page, 1).getByLabel("Slide text")).toHaveValue(
      "Fixture slide text for page 1. Metformin 500 mg.",
    );

    // Correct slide 1 and keep it after a reload.
    const first = card(page, 1);
    await first.getByLabel("Slide text").fill("Corrected text. Metformin 850 mg.");
    await first.getByRole("button", { name: "Save correction" }).click();
    await expect(first.getByText("Corrected", { exact: true })).toBeVisible();
    page = await reopen(page, docPath);
    await expect(card(page, 1).getByLabel("Slide text")).toHaveValue(
      "Corrected text. Metformin 850 mg.",
    );
    await expect(card(page, 1).getByText("Corrected", { exact: true })).toBeVisible();
    await expect(card(page, 2).getByText("Corrected", { exact: true })).toHaveCount(0);

    // Reading stopped for the slide check; the corrected text is what questions are written from.
    await writeQuestions(page);
    // The fake pipeline finishes: questions are written and checked, the handout is ready.
    // No reload: the page converges by itself when the last stage finishes.
    await expect(page.getByText(/· Ready$/)).toBeVisible({ timeout: 90_000 });

    // A later correction sends the questions that cite the slide back for review (R38).
    // The fake writes both of its questions from slide 1.
    page = await reopen(page, docPath);
    const again = card(page, 1);
    await page.locator('div[data-hydrated="true"]', { has: page.getByRole("checkbox") }).waitFor();
    await again.getByLabel("Slide text").fill("Corrected text. Metformin 1000 mg.");
    await again.getByRole("button", { name: "Save correction" }).click();
    await expect(
      again.getByText("Saved. 2 questions that use this slide now need review."),
    ).toBeVisible();
    page = await reopen(page, docPath);
    await expect(
      page.getByRole("region", { name: "Coverage report" }).getByText("2 need review · 0 retired"),
    ).toBeVisible();

    // "View photo" opens a signed URL that works.
    // The browser's own request for the opened photo must succeed. (Which viewer shows a
    // PDF page differs by browser, so assert the signed-URL response, not the new tab.)
    const photoResponse = page
      .context()
      .waitForEvent("response", (r) => r.url().includes("/storage/v1/object/sign/materials/"));
    await card(page, 2).getByRole("button", { name: "View photo" }).click();
    expect((await photoResponse).status()).toBe(200);

    // A student sees the corrected text but no editing controls.
    const studentContext = await browser.newContext();
    const studentPage = await studentContext.newPage();
    await loginAs(studentPage, "student");
    await studentPage.goto(docPath);
    await expect(card(studentPage, 1)).toBeVisible();
    await expect(card(studentPage, 1)).toContainText("Corrected text. Metformin 1000 mg.");
    await expect(studentPage.getByRole("textbox")).toHaveCount(0);
    await expect(studentPage.getByRole("button", { name: "Save correction" })).toHaveCount(0);
    await expect(card(studentPage, 2).getByRole("button", { name: "View photo" })).toBeVisible();

    // A failed pipeline reads plainly to a student, and the page follows later progress
    // by itself (it re-reads every 15 s) without a reload.
    const { createClient } = await import("@supabase/supabase-js");
    const service = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
    const docId = docPath.split("/").pop()!;
    await service.from("documents").update({ status: "processing" }).eq("id", docId);
    const { error: jobError } = await service
      .from("jobs")
      .insert({ kind: "generate", document_id: docId, status: "failed", error: "boom" });
    expect(jobError).toBeNull();
    await studentPage.reload();
    const attention = studentPage.getByText(
      "This handout needs attention before its slides are ready. Please check back later.",
    );
    await expect(attention).toBeVisible();
    await service.from("documents").update({ status: "ready" }).eq("id", docId);
    await expect(studentPage.getByText(/· Ready$/)).toBeVisible({ timeout: 30_000 });
    await expect(attention).toHaveCount(0);
    await studentContext.close();
  });

  test("the toggle shows only slides that need checking", async ({ page }) => {
    await loginAs(page, "admin");
    const docPath = await uploadTwoPageHandout(page, "Toggle handout");
    await expect(card(page, 2)).toBeVisible({ timeout: 90_000 });

    // Mark slide 2 as partly readable, with an uncertain term.
    const { createClient } = await import("@supabase/supabase-js");
    const service = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
    const docId = docPath.split("/").pop()!;
    const { data: slidePage } = await service
      .from("source_pages")
      .select("id")
      .eq("document_id", docId)
      .eq("page_no", 2)
      .single();
    const { error } = await service
      .from("source_slides")
      .update({
        legibility: "partial",
        uncertain_terms: ["glipizide"],
        verbatim_text: "Dose of [?glipizide?] is 5 mg.",
      })
      .eq("page_id", slidePage!.id);
    expect(error).toBeNull();

    page = await reopen(page, docPath);
    await expect(card(page, 2).getByText("Partly readable", { exact: true })).toBeVisible();
    await expect(card(page, 2).locator("mark")).toHaveText("glipizide");
    // The list must be hydrated, or webkit loses the click.
    await page.locator('div[data-hydrated="true"]', { has: page.getByRole("checkbox") }).waitFor();
    await page.getByRole("checkbox", { name: "Show only slides that need checking" }).check();
    await expect(page.getByRole("article")).toHaveCount(1);
    await expect(card(page, 2)).toBeVisible();
    await page.getByRole("checkbox", { name: "Show only slides that need checking" }).uncheck();
    await expect(page.getByRole("article")).toHaveCount(2);
  });
});
