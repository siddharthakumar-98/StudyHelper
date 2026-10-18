import { expect, test, type Page } from "@playwright/test";
import {
  REVIEW_NOTE,
  bumpQuestionVersion,
  SEEDED_CORRECT_TEXT,
  SEEDED_EXPLANATION,
  loginAs,
  seedQuestions,
  waitHydrated,
} from "./helpers";

// AI_FAKE=1 (set by the Playwright web server). Specs here count rows exactly, so each
// test wipes the database and seeds 3 active + 1 needs-review questions (Ruling R3).

const THANKS = "Thanks — this question is now out of practice tests until it's checked.";

type Seed = Awaited<ReturnType<typeof seedQuestions>>;
let seed: Seed;

test.beforeEach(async () => {
  seed = await seedQuestions({ active: 3, needsReview: 1 });
});

const chip = (page: Page, group: string, name: string) =>
  page.getByRole("group", { name: group }).getByRole("link", { name, exact: true });

test.describe("question bank", () => {
  test("admin reviews the queue and approves a question into Active", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto("/bank");
    await waitHydrated(page);

    // The queue is not empty, so the admin lands on Needs review.
    await expect(chip(page, "Status", "Needs review")).toHaveAttribute("aria-current", "true");
    await expect(page.getByText("1 question", { exact: true })).toBeVisible();
    const queued = seed.needsReview[0];
    await expect(page.getByRole("link", { name: new RegExp(queued.stem) })).toBeVisible();

    await page.getByRole("link", { name: new RegExp(queued.stem) }).click();
    await expect(page).toHaveURL(new RegExp(`/bank/${queued.id}$`));
    await waitHydrated(page);
    await expect(page.getByText(REVIEW_NOTE)).toBeVisible();
    await expect(page.getByText("Needs review", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Approve" }).click();
    await expect(page.getByText("Approved. This question is now in practice tests.")).toBeVisible();
    await expect(page.getByText("Active", { exact: true })).toBeVisible();

    // The queue is empty now, so the list opens on Active, with all four.
    await page.goto("/bank");
    await waitHydrated(page);
    await expect(chip(page, "Status", "Active")).toHaveAttribute("aria-current", "true");
    await expect(page.getByText("4 questions", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: new RegExp(queued.stem) })).toBeVisible();
  });

  test("admin sees the answer key and the review tools; Reject needs a reason", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto(`/bank/${seed.active[0].id}`);
    await waitHydrated(page);
    await expect(page.getByText(SEEDED_EXPLANATION)).toBeVisible();
    await expect(page.getByText("Correct answer", { exact: true })).toBeVisible();
    for (const name of ["Edit", "Write a new version", "Reject"]) {
      await expect(page.getByRole("button", { name })).toBeVisible();
    }
    // Active questions are already approved.
    await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(0);

    await page.getByRole("button", { name: "Reject", exact: true }).click();
    await page.getByRole("button", { name: "Reject this question" }).click();
    await expect(page.getByText("Please say why you are rejecting this question.")).toBeVisible();
    await page.getByLabel("Why are you rejecting it?").fill("Not clinically useful");
    await page.getByRole("button", { name: "Reject this question" }).click();
    await expect(page.getByText("Rejected. This question is retired.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Edit" })).toHaveCount(0);
  });

  test("admin edit shows validation problems inline, then saves a new version", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto(`/bank/${seed.active[0].id}`);
    await waitHydrated(page);
    await page.getByRole("button", { name: "Edit", exact: true }).click();

    // Two options with the same text break a rule the server checks.
    await page.getByLabel("Option B").fill(SEEDED_CORRECT_TEXT);
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("form", { name: "Edit question" }).getByRole("alert")).toContainText(
      "Two options have the same text",
    );

    await page.getByLabel("Option B").fill("1650/TDD");
    await page.getByLabel("Question text").fill("A reworded question about the carbohydrate ratio?");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Saved as version 2.")).toBeVisible();
    await expect(page.getByText("A reworded question about the carbohydrate ratio?").first()).toBeVisible();
    await expect(page.getByText("2 versions", { exact: false })).toBeVisible();
  });

  test("a page that went stale asks the admin to reload instead of overwriting", async ({ page }) => {
    await loginAs(page, "admin");
    const id = seed.active[0].id;
    await page.goto(`/bank/${id}`);
    await waitHydrated(page);
    await bumpQuestionVersion(id);

    // Writing a new version is refused before any AI call is made.
    await page.getByRole("button", { name: "Write a new version" }).click();
    const stale = "This question was changed elsewhere. Reload to see the latest version.";
    await expect(page.getByText(stale)).toBeVisible();
    await page.getByRole("button", { name: "Reload", exact: true }).click();
    await expect(page.getByText("Changed by someone else in another tab").first()).toBeVisible();
    await expect(page.getByText(stale)).toHaveCount(0);
    await expect(page.getByText("2 versions", { exact: false })).toBeVisible();
  });

  test("a student never receives the answer key, and flagging pulls the question from practice", async ({
    page,
    browser,
  }) => {
    await loginAs(page, "student");
    await page.goto("/bank");
    await waitHydrated(page);
    await expect(page.getByText("3 questions", { exact: true })).toBeVisible();
    // Students filter by Active and Flagged only.
    await expect(chip(page, "Status", "Active")).toHaveAttribute("aria-current", "true");
    await expect(chip(page, "Status", "Flagged")).toBeVisible();
    await expect(chip(page, "Status", "Needs review")).toHaveCount(0);
    await expect(page.getByRole("link", { name: new RegExp(seed.needsReview[0].stem) })).toHaveCount(0);

    const mcq = seed.active[0];
    await page.getByRole("link", { name: new RegExp(mcq.stem) }).click();
    await expect(page).toHaveURL(new RegExp(`/bank/${mcq.id}$`));
    await waitHydrated(page);
    await expect(page.getByText(mcq.stem).first()).toBeVisible();
    // The options are listed, but nothing says which is right and no key text is on the page.
    await expect(page.getByRole("list", { name: "Answer options" }).getByRole("listitem")).toHaveCount(4);
    await expect(page.getByText("Explanation")).toHaveCount(0);
    await expect(page.getByText("Correct answer")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(0);
    const html = await page.content();
    expect(html).not.toContain("Explanation");
    expect(html).not.toContain(SEEDED_EXPLANATION);
    expect(html).not.toContain(REVIEW_NOTE);
    expect(html).not.toContain("correct_option_id");
    expect(html).not.toContain("correctOptionId");

    await page.getByRole("button", { name: "Flag a problem" }).click();
    await page.getByLabel("What looks wrong? (optional)").fill("The slide says 1650, not this");
    await page.getByRole("button", { name: "Send flag" }).click();
    await expect(page.getByText(THANKS)).toBeVisible();
    await expect(page.getByText("Flagged", { exact: true })).toBeVisible();

    // The admin finds it under Flagged, with the comment.
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    await loginAs(adminPage, "admin");
    await adminPage.goto("/bank?status=flagged");
    await waitHydrated(adminPage);
    await expect(adminPage.getByText("1 question", { exact: true })).toBeVisible();
    await adminPage.getByRole("link", { name: new RegExp(mcq.stem) }).click();
    await waitHydrated(adminPage);
    await expect(adminPage.getByText("The slide says 1650, not this")).toBeVisible();
    await expect(adminPage.getByRole("button", { name: "Approve" })).toBeVisible();
    await adminContext.close();
  });

  test("a student's SAQ page shows the question only", async ({ page }) => {
    await loginAs(page, "student");
    const saq = seed.active[2];
    await page.goto(`/bank/${saq.id}`);
    await waitHydrated(page);
    await expect(page.getByText(saq.stem).first()).toBeVisible();
    const html = await page.content();
    for (const secret of ["Divide five hundred", "Uses 1800", "Names 500", "Model answer", "Key concepts"]) {
      expect(html).not.toContain(secret);
    }
  });

  test("filter chips wrap on a phone and the page never scrolls sideways", async ({ page }, testInfo) => {
    await loginAs(page, "admin");
    await page.goto("/bank");
    await waitHydrated(page);
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(await overflow()).toBeLessThanOrEqual(0);

    // Every chip is a comfortable target.
    for (const link of await page.getByRole("group", { name: "Status" }).getByRole("link").all()) {
      const box = (await link.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(47.5);
      expect(box.width).toBeGreaterThanOrEqual(47.5);
    }

    if (testInfo.project.name === "mobile") {
      const tops = await page
        .getByRole("group", { name: "Status" })
        .getByRole("link")
        .evaluateAll((links) => [...new Set(links.map((l) => Math.round(l.getBoundingClientRect().top)))]);
      expect(tops.length).toBeGreaterThan(1);
    }

    await page.goto(`/bank/${seed.needsReview[0].id}`);
    await waitHydrated(page);
    expect(await overflow()).toBeLessThanOrEqual(0);
  });
});
