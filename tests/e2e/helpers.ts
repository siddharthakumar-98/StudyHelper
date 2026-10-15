import { expect, type Page } from "@playwright/test";

export async function loginAs(page: Page, who: "student" | "admin" = "student") {
  const prefix = who.toUpperCase();
  await page.goto("/login");
  await page.getByLabel("Email").fill(process.env[`${prefix}_EMAIL`]!);
  await page.getByLabel("Password").fill(process.env[`${prefix}_PASSWORD`]!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/$/);
}
