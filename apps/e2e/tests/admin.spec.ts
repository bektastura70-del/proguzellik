import { expect, test } from "@playwright/test";
import { PASSWORD } from "../env";
import { apiGet, authFile, expectToast, login, uniq } from "./helpers";

test.describe("İşletme sahibi modülleri", () => {
  test.use({ storageState: authFile("owner") });

  test("raporlar sayfası gerçek verilerle dolu", async ({ page }) => {
    await page.goto("/panel/raporlar");
    await expect(page.getByText("Net kasa")).toBeVisible();
    await expect(page.getByRole("img", { name: "Günlük gelir grafiği" })).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: "Klasik Cilt Bakımı" }).first()).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: "Elif" }).first()).toBeVisible();
  });

  test("bildirimler sayfası planlanan WhatsApp mesajlarını listeler (test modu)", async ({ page }) => {
    // Panelden bir randevu oluşturulunca onay + hatırlatma planlanır.
    const services = await apiGet<{ id: string; name: string }[]>(page, "/services");
    const staff = await apiGet<{ id: string; displayName: string }[]>(page, "/staff");
    const customers = await apiGet<{ items: { id: string }[] }>(page, "/customers?search=Sena");
    const slots = await apiGet<{ startsAt: string; staffId: string }[]>(
      page,
      `/availability?date=${new Date(Date.now() + 9 * 86_400_000).toISOString().slice(0, 10)}&serviceId=${services.find((s) => s.name === "Kirpik Lifting")!.id}&staffId=${staff.find((s) => s.displayName === "Selin")!.id}`,
    );
    const res = await page.request.post("/api/p/appointments", {
      data: { customerId: customers.items[0].id, serviceId: services.find((s) => s.name === "Kirpik Lifting")!.id, staffId: slots[0].staffId, startsAt: slots[0].startsAt },
    });
    expect(res.status()).toBe(201);
    await page.goto("/panel/bildirimler");
    await expect(page.getByText(/mesajlar gönderilmez/)).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: "Randevu onayı" }).first()).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: "Hatırlatma (24 saat önce)" }).first()).toBeVisible();
    await expect(async () => {
      await page.reload();
      await expect(page.getByRole("row").filter({ hasText: "Randevu onayı" }).first()).toContainText("Gönderildi");
    }).toPass({ timeout: 15_000 });
  });

  test("yapay zekâ asistanı yerel modda yanıt verir", async ({ page }) => {
    await page.goto("/panel/asistan");
    await page.getByRole("button", { name: "Bu ay nasıl gidiyoruz?" }).click();
    await expect(page.getByText(/Işıltı Güzellik Stüdyosu için son 30 gün özeti/)).toBeVisible();
    await expect(page.getByText("Yerel kural tabanlı mod")).toBeVisible();
  });

  test("işletme ayarları kaydedilir ve korunur", async ({ page }) => {
    await page.goto("/panel/ayarlar");
    await page.getByLabel("Adres").fill("Test Cad. No:5, Kadıköy");
    await page.getByRole("button", { name: "Kaydet" }).click();
    await expectToast(page, "Ayarlar kaydedildi");
    await page.reload();
    await expect(page.getByLabel("Adres")).toHaveValue("Test Cad. No:5, Kadıköy");
  });

  test("ekibe kullanıcı eklenir; ilk girişte parola değiştirmek zorunludur", async ({ page, browser }) => {
    const email = `${uniq("yeni").replace(" ", "-")}@proguzellik.local`;
    await page.goto("/panel/ayarlar");
    await page.getByRole("button", { name: "Kullanıcı ekle" }).click();
    const dlg = page.getByRole("dialog");
    await dlg.getByLabel("Ad soyad").fill("Yeni Resepsiyon");
    await dlg.getByLabel("E-posta").fill(email);
    await dlg.getByLabel("Rol").selectOption("RECEPTION");
    await dlg.getByRole("button", { name: "Ekle" }).click();
    const temp = (await dlg.locator("code").textContent())!.trim();
    expect(temp.length).toBeGreaterThan(8);

    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const p2 = await ctx.newPage();
    await p2.goto("/giris");
    await p2.getByLabel("E-posta").fill(email);
    await p2.getByLabel("Parola").fill(temp);
    await p2.getByRole("button", { name: "Giriş yap" }).click();
    await expect(p2).toHaveURL(/parola-degistir/);
    await p2.goto("/panel/musteriler");
    await expect(p2).toHaveURL(/parola-degistir/);
    await p2.getByLabel("Mevcut (geçici) parola").fill(temp);
    await p2.getByLabel("Yeni parola", { exact: true }).fill("YeniResepsiyon2026");
    await p2.getByLabel("Yeni parola (tekrar)").fill("YeniResepsiyon2026");
    await p2.getByRole("button", { name: "Parolayı kaydet" }).click();
    await expect(p2).toHaveURL(/\/panel/);
    await p2.goto("/panel/musteriler");
    await expect(p2.getByRole("heading", { name: "Müşteriler" })).toBeVisible();
    // Resepsiyon ayarlar menüsünü görmez
    await expect(p2.getByRole("link", { name: "Ayarlar" })).toHaveCount(0);
    await ctx.close();
  });

  test("abonelik: test ödemesi başarısızlığı ve başarılı aktivasyon", async ({ page }) => {
    await page.goto("/panel/abonelik");
    await expect(page.getByText(/Deneme süresinden/)).toBeVisible();
    await page.getByRole("button", { name: "Yenile" }).or(page.getByRole("button", { name: "Seç" })).last().click();
    const dlg = page.getByRole("dialog");
    await expect(dlg.getByText(/gerçek ödeme alınmaz/)).toBeVisible();
    await dlg.getByLabel(/Test ödeme belirteci/).fill("tok_fail");
    await dlg.getByRole("button", { name: /Test ödemesiyle etkinleştir/ }).click();
    await expect(dlg.getByText("Kart reddedildi (test)")).toBeVisible();
    await dlg.getByLabel(/Test ödeme belirteci/).fill("tok_test");
    await dlg.getByLabel("Ödeme dönemi").selectOption("MONTHLY");
    await dlg.getByRole("button", { name: /Test ödemesiyle etkinleştir/ }).click();
    await expectToast(page, "Abonelik etkinleştirildi");
    await expect(page.getByRole("row").filter({ hasText: "Ödendi" }).first()).toBeVisible();
    const sub = await apiGet<{ status: string }>(page, "/subscription");
    expect(sub.status).toBe("ACTIVE");
  });
});

test.describe("SaaS sahibi paneli", () => {
  test.use({ storageState: authFile("platform") });

  test("istatistikler, işletme listesi, askıya alma ve geri açma", async ({ page, browser }) => {
    await page.goto("/yonetim");
    await expect(page.getByText("MRR (aylık gelir)")).toBeVisible();
    const row = page.getByRole("row").filter({ hasText: "Örnek Kuaför" });
    await expect(row).toContainText("kuafor@proguzellik.local");
    await row.getByRole("button", { name: "Yönet" }).click();
    await page.getByRole("dialog").getByLabel("Durum").selectOption("SUSPENDED");
    await page.getByRole("dialog").getByRole("button", { name: "Kaydet" }).click();
    await expectToast(page, "İşletme güncellendi");
    await expect(row).toContainText("Askıda");

    const ctx = await browser.newContext({ storageState: authFile("other") });
    const p2 = await ctx.newPage();
    const res = await p2.request.get("/api/p/customers");
    expect(res.status()).toBe(403);
    await ctx.close();

    await row.getByRole("button", { name: "Yönet" }).click();
    await page.getByRole("dialog").getByLabel("Durum").selectOption("ACTIVE");
    await page.getByRole("dialog").getByRole("button", { name: "Kaydet" }).click();
    await expect(row).toContainText("Aktif");
  });

  test("paket fiyatı güncellenir", async ({ page }) => {
    await page.goto("/yonetim");
    const row = page.getByRole("row").filter({ hasText: "Başlangıç" }).filter({ has: page.getByRole("button", { name: "Düzenle" }) });
    await row.getByRole("button", { name: "Düzenle" }).click();
    await page.getByRole("dialog").getByLabel("Aylık (₺)").fill("549");
    await page.getByRole("dialog").getByRole("button", { name: "Kaydet" }).click();
    await expectToast(page, "Paket güncellendi");
    await expect(row).toContainText("₺549,00");
  });

  test("işletme sahibi /yonetim sayfasına erişemez", async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: authFile("owner") });
    const p = await ctx.newPage();
    await p.goto("/yonetim");
    await expect(p.getByText("Bu sayfa yalnızca platform yöneticilerine açıktır.")).toBeVisible();
    await ctx.close();
  });
});

test("yeni işletme kaydı: 14 günlük deneme ile panel açılır", async ({ page }) => {
  const email = `${uniq("kayit").replace(" ", "-")}@proguzellik.local`;
  await page.goto("/kayit");
  await page.getByLabel("Salon adı").fill(uniq("E2E Salon"));
  await page.getByLabel("Adınız soyadınız").fill("Test Sahip");
  await page.getByLabel("E-posta").fill(email);
  await page.getByLabel("Parola", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Parola (tekrar)").fill(PASSWORD);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Ücretsiz denemeyi başlat" }).click();
  await expect(page).toHaveURL(/\/panel/);
  await expect(page.getByText(/Deneme sürenizin bitmesine/)).toContainText("14 gün");
  await login(page, email);
});
