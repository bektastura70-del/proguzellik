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
  // WhatsApp bağlı değil, e-posta verilmedi: WhatsApp onayı vaat edilmez.
  await expect(page.getByTestId("onay-metni")).toContainText("Randevunuz işletmeye iletildi.");
  // Müşteri sayfaya döndüğünde randevusunu görür (bağlantıyı kaybetse de yeniden kayıt gerekmez).
  await page.getByRole("button", { name: "Salon sayfasına dön" }).click();
  const saved = page.getByTestId("kayitli-randevular");
  await expect(saved).toContainText("Kirpik Lifting");
  await saved.getByRole("link", { name: "Görüntüle / iptal et" }).click();
  await expect(page.getByTestId("randevu-ozeti")).toContainText("Kirpik Lifting");
  await page.getByRole("button", { name: "Evet, iptal et" }).click();
  await expect(page.getByText("Randevunuz iptal edildi.")).toBeVisible();
  await page.getByRole("link", { name: "Salon sayfasına dön" }).click();
  await expect(page.getByRole("heading", { name: "Işıltı Güzellik Stüdyosu" })).toBeVisible();
  await expect(page.getByTestId("kayitli-randevular")).toHaveCount(0);
});

test("bilgilerimi hatırla: sonraki randevuda form dolu gelir, Tekrar al son hizmeti seçer, unut siler", async ({ page }) => {
  await page.goto("/r/isilti-guzellik");
  await page.getByRole("button", { name: /Kirpik Lifting/ }).click();
  const days = page.locator("main .overflow-x-auto button");
  let found = false;
  for (let i = 1; i < 10 && !found; i++) {
    await days.nth(i).click();
    await page.waitForTimeout(400);
    found = (await page.getByRole("button", { name: /^\d{2}:\d{2}$/ }).count()) > 0;
  }
  expect(found).toBe(true);
  await page.getByRole("button", { name: /^\d{2}:\d{2}$/ }).first().click();
  const phone = `0555${String(Date.now()).slice(-7)}`;
  await page.getByLabel("Adınız", { exact: true }).fill("Hatırla");
  await page.getByLabel("Soyadınız").fill("Deneme");
  await page.getByLabel("Cep telefonu").fill(phone);
  // Varsayılan olarak işaretli değildir (açık rıza ile).
  await expect(page.getByTestId("bilgileri-hatirla")).not.toBeChecked();
  await page.getByTestId("bilgileri-hatirla").check();
  await page.getByRole("checkbox").first().check();
  await page.getByRole("button", { name: "Randevuyu onayla" }).click();
  await expect(page.getByRole("heading", { name: "Randevunuz alındı" })).toBeVisible();

  // Uygulama yeniden açılmış gibi: sayfa baştan yüklenir.
  await page.goto("/r/isilti-guzellik");
  await expect(page.getByTestId("kayitli-randevular")).toContainText("Kirpik Lifting");
  const rebook = page.getByTestId("tekrar-al");
  await expect(rebook).toContainText("Kirpik Lifting");
  await rebook.getByRole("button", { name: "Tekrar al" }).click();
  await expect(page.getByRole("button", { name: /Kirpik Lifting/ })).toHaveClass(/border-brand-500/);
  found = false;
  for (let i = 1; i < 10 && !found; i++) {
    await days.nth(i).click();
    await page.waitForTimeout(400);
    found = (await page.getByRole("button", { name: /^\d{2}:\d{2}$/ }).count()) > 0;
  }
  await page.getByRole("button", { name: /^\d{2}:\d{2}$/ }).first().click();
  await expect(page.getByLabel("Adınız", { exact: true })).toHaveValue("Hatırla");
  await expect(page.getByLabel("Cep telefonu")).toHaveValue(phone);
  await expect(page.getByTestId("bilgileri-hatirla")).toBeChecked();
  await page.getByTestId("bilgileri-unut").click();
  await expect(page.getByLabel("Adınız", { exact: true })).toHaveValue("");
  expect(await page.evaluate(() => localStorage.getItem("pg_contact"))).toBeNull();

  // Temizlik: alınan randevu iptal edilir.
  await page.getByTestId("kayitli-randevular").getByRole("link", { name: "Görüntüle / iptal et" }).first().click();
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
  expect(await page.locator('meta[name="robots"][content*="noindex"]').count()).toBeGreaterThan(0);
});
