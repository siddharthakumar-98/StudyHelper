import { expect, test } from "@playwright/test";

test("login page responds", async ({ page }) => {
  const response = await page.goto("/login");
  expect(response?.status()).toBeLessThan(400);
});
