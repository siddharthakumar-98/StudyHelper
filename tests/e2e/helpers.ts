import { expect, type Page } from "@playwright/test";

/** Waits until the login form is hydrated, so fill/click are never lost to a cold compile. */
export async function openLogin(page: Page) {
  await page.goto("/login");
  await page.locator('form[data-hydrated="true"]').waitFor();
}

export async function loginAs(page: Page, who: "student" | "admin" = "student") {
  const prefix = who.toUpperCase();
  await openLogin(page);
  await page.getByLabel("Email").fill(process.env[`${prefix}_EMAIL`]!);
  await page.getByLabel("Password").fill(process.env[`${prefix}_PASSWORD`]!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
}
