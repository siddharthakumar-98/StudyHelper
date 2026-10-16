import { expect, test, type Page } from "@playwright/test";
import { loginAs } from "./helpers";
import { makePdf } from "../fixtures/makePdf";

// AI_FAKE=1 (set by the Playwright web server): one clear slide per page. The
// pipeline then stops at topic_map, which has no handler yet; only slides are asserted.

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
  await expect(page).toHaveURL(/\/materials\/[0-9a-f-]{36}/, { timeout: 90_000 });
  return new URL(page.url()).pathname;
}

const card = (page: Page, n: number) =>
  page.getByRole("article", { name: new RegExp(`^Slide ${n}\\b`) });

test.describe("slide review", () => {
  test.describe.configure({ timeout: 180_000 });

  test("admin reviews and corrects slides, student reads them", async ({ page, browser }) => {
    await loginAs(page, "admin");
    const docPath = await uploadTwoPageHandout(page, "Slide review handout");

    await expect(page.getByText("Reading slides").first()).toBeVisible({ timeout: 60_000 });
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
    await page.goto(docPath);
    await expect(card(page, 1).getByLabel("Slide text")).toHaveValue(
      "Corrected text. Metformin 850 mg.",
    );
    await expect(card(page, 1).getByText("Corrected", { exact: true })).toBeVisible();
    await expect(card(page, 2).getByText("Corrected", { exact: true })).toHaveCount(0);

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
    await expect(card(studentPage, 1)).toContainText("Corrected text. Metformin 850 mg.");
    await expect(studentPage.getByRole("textbox")).toHaveCount(0);
    await expect(studentPage.getByRole("button", { name: "Save correction" })).toHaveCount(0);
    await expect(card(studentPage, 2).getByRole("button", { name: "View photo" })).toBeVisible();
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

    await page.goto(docPath);
    await expect(card(page, 2).getByText("Partly readable", { exact: true })).toBeVisible();
    await expect(card(page, 2).locator("mark")).toHaveText("glipizide");
    await page.getByRole("checkbox", { name: "Show only slides that need checking" }).check();
    await expect(page.getByRole("article")).toHaveCount(1);
    await expect(card(page, 2)).toBeVisible();
    await page.getByRole("checkbox", { name: "Show only slides that need checking" }).uncheck();
    await expect(page.getByRole("article")).toHaveCount(2);
  });
});
