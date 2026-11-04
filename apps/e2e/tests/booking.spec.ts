import { expect, test } from "@playwright/test";

test("online rezervasyon: hizmet → gün → saat → bilgiler → onay → iptal", async ({ page }) => {
  await page.goto("/r/isilti-guzellik");
  await expect(page.getByRole("heading", { name: "Işıltı Güzellik Stüdyosu" })).toBeVisible();
  await page.getByRole("button", { name: /Kirpik Lifting/ }).click();
  // İlk müsait günü bul
  const days = page.locator("main .overflow-x-auto button");
  let found = false;
  for (let i = 1; i < 10 && !found; i++) {
    await days.nth(i).click();
    await page.waitForTimeout(400);
    found = (await page.getByRole("button", { name: /^\d{2}:\d{2}$/ }).count()) > 0;
  }
  expect(found).toBe(true);
  await page.getByRole("button", { name: /^\d{2}:\d{2}$/ }).first().click();
  await page.getByLabel("Adınız", { exact: true }).fill("Online");
  await page.getByLabel("Soyadınız").fill("Deneme");
  await page.getByLabel("Cep telefonu").fill(`0555${String(Date.now()).slice(-7)}`);
  await page.getByRole("checkbox").first().check();
  await page.getByRole("button", { name: "Randevuyu onayla" }).click();
  await expect(page.getByRole("heading", { name: "Randevunuz alındı" })).toBeVisible();
  await expect(page.getByText("Kirpik Lifting")).toBeVisible();
  await page.getByRole("link", { name: "Randevuyu iptal et" }).click();
  await page.getByRole("button", { name: "Evet, iptal et" }).click();
  await expect(page.getByText("Randevunuz iptal edildi.")).toBeVisible();
});

test("KVKK onayı olmadan rezervasyon gönderilemez", async ({ page }) => {
  await page.goto("/r/isilti-guzellik");
  await page.getByRole("button", { name: /Kalıcı Oje/ }).click();
  const days = page.locator("main .overflow-x-auto button");
  for (let i = 1; i < 10; i++) {
    await days.nth(i).click();
    await page.waitForTimeout(400);
    if ((await page.getByRole("button", { name: /^\d{2}:\d{2}$/ }).count()) > 0) break;
  }
  await page.getByRole("button", { name: /^\d{2}:\d{2}$/ }).first().click();
  await page.getByLabel("Adınız", { exact: true }).fill("A");
  await page.getByLabel("Soyadınız").fill("B");
  await page.getByLabel("Cep telefonu").fill("05551112299");
  await page.getByRole("button", { name: "Randevuyu onayla" }).click();
  await expect(page.getByRole("heading", { name: "Randevunuz alındı" })).toHaveCount(0);
  expect(await page.getByRole("checkbox").first().evaluate((el: HTMLInputElement) => el.validity.valueMissing)).toBe(true);
});

test("kapalı veya bilinmeyen işletme sayfası açık bilgi verir", async ({ page }) => {
  const res = await page.goto("/r/olmayan-salon");
  expect(res?.status()).toBe(404);
  await expect(page.getByText("Bu işletme şu an online randevu almıyor.")).toBeVisible();
  expect(await page.locator('meta[name="robots"]').getAttribute("content")).toMatch(/noindex/);
});
