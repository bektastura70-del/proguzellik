import { expect, test, type Browser, type Page } from "@playwright/test";
import { apiGet, authFile, expectToast } from "./helpers";

/**
 * WhatsApp'sız salonda online randevu onayı (28.11 gerçek salon): müşteri online randevu alır, sahip panel ana
 * sayfasında "Onay bekleyen randevular" kartında onaylar / reddeder; bildirim merkezinden randevuya gidilir.
 * Ekranlarda WhatsApp hatası/uyarısı görünmez.
 */

async function bookOnline(page: Page, firstName: string, email?: string) {
  await page.goto("/r/isilti-guzellik");
  await page.getByRole("button", { name: /Kirpik Lifting/ }).click();
  const days = page.locator("main .overflow-x-auto button");
  let found = false;
  // Takvim testlerinin kullandığı önümüzdeki pazartesiye denk gelmesin diye ikinci haftadan başlanır.
  for (let i = 10; i < 14 && !found; i++) {
    await days.nth(i).click();
    await page.waitForTimeout(400);
    found = (await page.getByRole("button", { name: /^\d{2}:\d{2}$/ }).count()) > 0;
  }
  expect(found).toBe(true);
  await page.getByRole("button", { name: /^\d{2}:\d{2}$/ }).last().click();
  await page.getByLabel("Adınız", { exact: true }).fill(firstName);
  await page.getByLabel("Soyadınız").fill("Onaytest");
  await page.getByLabel("Cep telefonu").fill(`0555${String(Date.now()).slice(-7)}`);
  if (email) await page.getByLabel(/^E-posta/).fill(email);
  await page.getByRole("checkbox").first().check();
  await page.getByRole("button", { name: "Randevuyu onayla" }).click();
  await expect(page.getByRole("heading", { name: "Randevunuz alındı" })).toBeVisible();
}

/** Müşteri bir süre sonra salon sayfasını yeniden açar (aynı sekmedeki durum yenileme aralığı dolmuş gibi). */
async function customerReturns(page: Page) {
  await page.evaluate(() => sessionStorage.removeItem("pg_bookings_checked:isilti-guzellik"));
  await page.goto("/r/isilti-guzellik");
}

/** Kart ilk 5 satırı gösterir; aranan satır için gerekirse tümü açılır. */
async function pendingRow(owner: Page, name: string) {
  const card = owner.getByTestId("onay-bekleyenler");
  await expect(card).toBeVisible();
  const more = card.getByRole("button", { name: /Tümünü göster/ });
  if (await more.count()) await more.click();
  return card.getByTestId("onay-satiri").filter({ hasText: name });
}

async function ownerPage(browser: Browser) {
  const ctx = await browser.newContext({ storageState: authFile("owner") });
  return ctx.newPage();
}

test("sahip online randevuyu ana sayfadan onaylar; müşteri sayfasında 'Onaylandı' görünür", async ({ page, browser }) => {
  const name = `Onay${Date.now().toString(36).slice(-4)}`;
  await bookOnline(page, name, `${name.toLowerCase()}@musteri.test`);

  const owner = await ownerPage(browser);
  await owner.goto("/panel");
  const card = owner.getByTestId("onay-bekleyenler");
  await expect(owner.getByTestId("whatsapp-uyarisi")).toHaveCount(0);
  const row = await pendingRow(owner, name);
  await expect(row).toContainText("Kararınız müşteriye e-postayla bildirilir.");
  await row.getByRole("button", { name: "Onayla" }).click();
  await expectToast(owner, /Onaylandı/);
  await expect(card.getByTestId("onay-satiri").filter({ hasText: name })).toHaveCount(0);

  // Müşteri salon sayfasına dönünce kayıtlı randevusunun durumu sunucudan yenilenir.
  await customerReturns(page);
  await expect(page.getByTestId("kayitli-randevular")).toContainText("Onaylandı");
  await owner.context().close();
});

test("sahip e-postasız online randevuyu gerekçeyle reddeder; ara ve kendi WhatsApp'ından yaz bağlantıları var", async ({ page, browser }) => {
  const name = `Ret${Date.now().toString(36).slice(-4)}`;
  await bookOnline(page, name);

  const owner = await ownerPage(browser);
  await owner.goto("/panel/takvim");
  const row = await pendingRow(owner, name);
  await expect(row).toContainText("Müşteri e-posta vermedi");
  await expect(row.getByRole("link", { name: "Ara" })).toHaveAttribute("href", /^tel:/);
  await expect(row.getByRole("link", { name: /kendi WhatsApp/i })).toHaveAttribute("href", /^https:\/\/wa\.me\/90555\d{7}\?text=/);
  await row.getByRole("button", { name: "Reddet" }).click();
  const dlg = owner.getByRole("dialog", { name: "Randevuyu iptal et" });
  await expect(dlg.getByTestId("musteri-bildirim")).toContainText("Müşterinin e-postası yok");
  await expect(dlg).not.toContainText("WhatsApp");
  await dlg.getByRole("button", { name: "Bu saat dolu" }).click();
  await expect(dlg.getByLabel("İptal sebebi")).toHaveValue("Bu saat dolu");
  await dlg.getByRole("button", { name: "Reddet ve iptal et" }).click();
  await expectToast(owner, /İptal/);
  await expect(owner.getByTestId("onay-satiri").filter({ hasText: name })).toHaveCount(0);

  await customerReturns(page);
  await expect(page.getByTestId("kayitli-randevular")).toContainText("İptal edildi");
  await owner.context().close();
});

test("bildirim merkezinde yeni randevu bildirimine tıklayınca takvimde randevu açılır ve onaylanabilir", async ({ page, browser }) => {
  const name = `Bild${Date.now().toString(36).slice(-4)}`;
  await bookOnline(page, name);

  const owner = await ownerPage(browser);
  const list = await apiGet<{ items: { id: string; body: string; appointmentId: string | null }[] }>(owner, "/pwa/notifications");
  const n = list.items.find((x) => x.body.includes(name));
  expect(n?.appointmentId).toBeTruthy();
  await owner.goto("/panel/bildirim-merkezi");
  await expect(owner.getByTestId("bildirim-kanallari")).not.toContainText("bağlı değil");
  await owner.getByRole("button", { name: new RegExp(name) }).first().click();
  await expect(owner).toHaveURL(new RegExp(`/panel/takvim\\?gorunum=gun&tarih=\\d{4}-\\d{2}-\\d{2}&randevu=${n!.appointmentId}`));
  const dlg = owner.getByRole("dialog", { name: "Randevu" });
  await expect(dlg).toContainText(`${name} Onaytest`);
  await dlg.getByRole("button", { name: "Onayla" }).click();
  await expectToast(owner, /Onaylandı/);
  await owner.context().close();
});
