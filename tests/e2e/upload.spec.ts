import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { loginAs } from "./helpers";
import { makePdf } from "../fixtures/makePdf";

async function openUploadForm(page: Page) {
  await page.goto("/materials");
  await page.locator('form[data-hydrated="true"]').waitFor();
}

async function addHandout(
  page: Page,
  title: string,
  files: { name: string; mimeType: string; buffer: Buffer }[],
) {
  await openUploadForm(page);
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Pages (PDF or photos)").setInputFiles(files);
  await page.getByRole("button", { name: "Add handout" }).click();
  await expect(page).toHaveURL(/\/materials\/[0-9a-f-]{36}/, { timeout: 90_000 });
}

test.describe("handout upload", () => {
  test.describe.configure({ timeout: 180_000 });

  test("an admin uploads a 2-page PDF and sees 2 pages", async ({ page }) => {
    await loginAs(page, "admin");
    const pdf = Buffer.from(await makePdf({ pages: 2 }));
    await addHandout(page, "Two page handout", [
      { name: "two.pdf", mimeType: "application/pdf", buffer: pdf },
    ]);
    await expect(page.getByRole("heading", { name: "Two page handout" })).toBeVisible();
    await expect(page.getByText("2 pages").first()).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("list", { name: "Pages" }).getByText("PDF")).toHaveCount(2);
    // Reading pauses for the slide check: nothing is written until the admin says so (R38).
    await expect(
      page.getByRole("region", { name: "Next step" }).getByRole("button", { name: "Write questions" }),
    ).toBeVisible({ timeout: 90_000 });
  });

  test("a full-size 20 MB handout uploads straight to storage", async ({ page }) => {
    await loginAs(page, "admin");
    const pdf = Buffer.from(await makePdf({ pages: 2, padBytes: 20_000_000 }));
    expect(pdf.byteLength).toBeGreaterThan(20_000_000);
    await addHandout(page, "Large handout", [
      { name: "large.pdf", mimeType: "application/pdf", buffer: pdf },
    ]);
    await expect(page.getByText("2 pages").first()).toBeVisible({ timeout: 120_000 });
  });

  test("an iPhone HEIC photo becomes a JPG page", async ({ page }) => {
    await loginAs(page, "admin");
    await addHandout(page, "Phone photo", [
      {
        name: "IMG_0001.HEIC",
        mimeType: "image/heic",
        buffer: readFileSync("tests/fixtures/sample.heic"),
      },
    ]);
    await expect(page.getByText("1 page").first()).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("list", { name: "Pages" }).getByText("JPG")).toHaveCount(1);
  });

  test("a student cannot add handouts", async ({ page }) => {
    await loginAs(page, "student");
    await page.goto("/materials");
    await expect(page.getByRole("heading", { name: "Materials" })).toBeVisible();
    await expect(page.getByText("Add a handout")).toHaveCount(0);
    await expect(page.getByLabel("Pages (PDF or photos)")).toHaveCount(0);
  });
});
