import { expect, test } from "@playwright/test";
import { authFile } from "./helpers";

test.use({ storageState: authFile("owner") });

test("panel açılır ve demo işletmesi görünür", async ({ page }) => {
  await page.goto("/panel");
  await expect(page.getByRole("heading", { name: /Merhaba Deniz/ })).toBeVisible();
  await expect(page.getByText("Işıltı Güzellik Stüdyosu").first()).toBeVisible();
});
