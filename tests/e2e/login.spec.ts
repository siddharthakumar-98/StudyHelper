import { expect, test } from "@playwright/test";
import { openLogin } from "./helpers";

test.describe("login", () => {
  test("a wrong password shows an error", async ({ page }) => {
    await openLogin(page);
    await page.getByLabel("Email").fill(process.env.STUDENT_EMAIL!);
    await page.getByLabel("Password").fill("definitely-not-the-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("Email or password is incorrect")).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });

  test("correct student credentials land on the home page", async ({ page }) => {
    await openLogin(page);
    await page.getByLabel("Email").fill(process.env.STUDENT_EMAIL!);
    await page.getByLabel("Password").fill(process.env.STUDENT_PASSWORD!);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/$/);
  });

  test("visiting /bank while logged out redirects to /login", async ({ page }) => {
    await page.goto("/bank");
    await expect(page).toHaveURL(/\/login$/);
  });
});
