import { expect, test } from "@playwright/test";
import { loginAs } from "./helpers";

const LABELS = ["Home", "Practice", "Results", "Materials", "Question Bank"];

test.describe("app shell", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, "student");
  });

  test("shows the five tabs", async ({ page }) => {
    const nav = page.getByRole("navigation", { name: "Main" });
    for (const label of LABELS) {
      await expect(nav.getByRole("link", { name: label })).toBeVisible();
    }
    await expect(nav.getByRole("link", { name: "Home" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  test("nav sits at the bottom on small screens and on the left on desktop", async ({
    page,
  }, testInfo) => {
    const viewport = page.viewportSize()!;
    const box = (await page.getByRole("navigation", { name: "Main" }).boundingBox())!;
    if (testInfo.project.name === "desktop") {
      expect(box.x).toBeLessThan(5);
      expect(box.width).toBeLessThan(viewport.width / 3);
      expect(box.height).toBeGreaterThan(viewport.height / 4);
    } else {
      // mobile and tablet use the bottom bar
      expect(box.y + box.height).toBeGreaterThan(viewport.height - 5);
      expect(box.width).toBeGreaterThan(viewport.width - 5);
      expect(box.height).toBeLessThan(viewport.height / 4);
    }
  });

  test("never scrolls sideways, even at the largest text size", async ({ page }) => {
    const overflow = () =>
      page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
    expect(await overflow()).toBeLessThanOrEqual(0);
    await page.getByRole("button", { name: "A+" }).click();
    await page.getByRole("button", { name: "A+" }).click();
    expect(await overflow()).toBeLessThanOrEqual(0);
  });

  test("nav labels are readable and never broken mid-word, even at 1.3x", async ({
    page,
  }) => {
    const labels = page.locator("nav [data-nav-label]");
    const measure = () =>
      labels.evaluateAll((spans) =>
        spans.map((span) => {
          const link = span.closest("a")!;
          const range = document.createRange();
          range.selectNodeContents(span);
          const lines = new Set(
            Array.from(range.getClientRects()).map((r) => Math.round(r.top)),
          ).size;
          return {
            text: span.textContent!,
            fontSize: parseFloat(getComputedStyle(span).fontSize),
            words: span.textContent!.trim().split(/\s+/).length,
            lines,
            clipped: link.scrollWidth > link.clientWidth || span.scrollWidth > span.clientWidth,
          };
        }),
      );
    for (const size of ["1x", "1.3x"]) {
      if (size === "1.3x") {
        await page.getByRole("button", { name: "A+" }).click();
        await page.getByRole("button", { name: "A+" }).click();
      }
      for (const label of await measure()) {
        expect(label.fontSize, `${label.text} at ${size}`).toBeGreaterThanOrEqual(14);
        expect(label.lines, `${label.text} wraps only at spaces at ${size}`).toBeLessThanOrEqual(
          label.words,
        );
        expect(label.clipped, `${label.text} fits at ${size}`).toBe(false);
      }
    }
  });

  test("every nav link and button is at least 48x48", async ({ page }) => {
    const targets = page.locator("aside a, aside button");
    expect(await targets.count()).toBeGreaterThanOrEqual(5);
    for (const target of await targets.all()) {
      const box = (await target.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(48);
      expect(box.height).toBeGreaterThanOrEqual(48);
    }
  });

  test("A+ twice gives 23.4px and survives a reload", async ({ page }) => {
    const fontSize = () =>
      page.evaluate(() => getComputedStyle(document.documentElement).fontSize);
    expect(await fontSize()).toBe("18px");
    await page.getByRole("button", { name: "A+" }).click();
    await page.getByRole("button", { name: "A+" }).click();
    expect(await fontSize()).toBe("23.4px");
    await page.reload();
    expect(await fontSize()).toBe("23.4px");
  });

  test("shows the signed-in user and signs out", async ({ page }) => {
    await expect(page.getByText(process.env.STUDENT_EMAIL!)).toBeVisible();
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login$/);
  });

  test("home links to Materials and Question Bank", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Welcome" })).toBeVisible();
    const main = page.getByRole("main");
    await expect(main.getByRole("link", { name: "Materials" })).toBeVisible();
    await expect(main.getByRole("link", { name: "Question Bank" })).toBeVisible();
  });

  test("practice and results are placeholders", async ({ page }) => {
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Practice" }).click();
    await expect(page).toHaveURL(/\/practice$/);
    await expect(page.getByText("Coming in the next update")).toBeVisible();
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Results" }).click();
    await expect(page).toHaveURL(/\/results$/);
    await expect(page.getByText("Coming in the next update")).toBeVisible();
  });
});
