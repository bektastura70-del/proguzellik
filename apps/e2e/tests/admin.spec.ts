import { expect, test } from "@playwright/test";
import { PASSWORD } from "../env";
import { apiGet, authFile, expectToast, login, submitTrialForm, uniq } from "./helpers";
import { readFileSync } from "node:fs";
import { lastEmail, resetTotpReplay, sql, totp } from "./totp";

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
    // 9 gün sonrası; demo salonu pazar kapalı olduğundan pazara denk gelirse pazartesi.
    const day = new Date(Date.now() + 9 * 86_400_000);
    if (day.getUTCDay() === 0) day.setUTCDate(day.getUTCDate() + 1);
    const slots = await apiGet<{ startsAt: string; staffId: string }[]>(
      page,
      `/availability?date=${day.toISOString().slice(0, 10)}&serviceId=${services.find((s) => s.name === "Kirpik Lifting")!.id}&staffId=${staff.find((s) => s.displayName === "Selin")!.id}`,
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

  test("ekibe davet: geçici parola gösterilmez, davetli parolasını bağlantıdan belirler", async ({ page, browser }) => {
    const email = `${uniq("yeni").replace(" ", "-")}@proguzellik.local`;
    await page.goto("/panel/ayarlar");
    await page.getByRole("button", { name: "Kullanıcı davet et" }).click();
    const dlg = page.getByRole("dialog");
    await dlg.getByLabel("Ad soyad").fill("Yeni Resepsiyon");
    await dlg.getByLabel("E-posta").fill(email);
    await dlg.getByLabel("Rol").selectOption("RECEPTION");
    await expect(dlg.getByLabel("Rol").locator("option[value=OWNER]")).toHaveCount(0);
    await dlg.getByRole("button", { name: "Davet gönder" }).click();
    await expectToast(page, "Davet e-postası gönderildi");
    await expect(page.locator("code")).toHaveCount(0);
    const row = page.getByRole("row").filter({ hasText: email });
    await expect(row).toContainText("Gönderildi");

    const body = sql(`SELECT body FROM "OutboundEmail" WHERE "to" = '${email}' ORDER BY "createdAt" DESC LIMIT 1`);
    expect(body).toMatch(/resepsiyon görevlisi olarak/);
    const link = new URL(/https?:\/\/\S+\/davet\?token=[A-Za-z0-9_-]+/.exec(body)![0]);
    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const p2 = await ctx.newPage();
    await p2.goto(link.pathname + link.search);
    await p2.getByLabel("Parola", { exact: true }).fill("YeniResepsiyon2026");
    await p2.getByLabel("Parola (tekrar)").fill("YeniResepsiyon2026");
    await p2.getByRole("checkbox").check();
    await p2.getByRole("button", { name: "Daveti kabul et" }).click();
    await expect(p2).toHaveURL(/\/panel/);
    await p2.goto("/panel/musteriler");
    await expect(p2.getByRole("heading", { name: "Müşteriler" })).toBeVisible();
    // Resepsiyon ayarlar menüsünü görmez
    await expect(p2.getByRole("link", { name: "Ayarlar" })).toHaveCount(0);
    await ctx.close();
    await page.reload();
    await expect(page.getByRole("row").filter({ hasText: email })).toContainText("Yeni Resepsiyon");
  });

  test("abonelik: test ödemesi başarısızlığı ve başarılı aktivasyon", async ({ page }) => {
    // Satın alma yalnız SaaS sahibinin onayladığı fiyatla yapılabilir: test verisi olarak onaylı fiyat eklenir (KDV hariç 1.000 ₺, %20).
    sql(`INSERT INTO "PlanPrice" (id, "planCode", version, "monthlyPrice", "yearlyPrice", "vatRate", "effectiveFrom", "renewalPolicy", status, "approvedAt", "approvedById")
      SELECT gen_random_uuid(), 'SMART', COALESCE(max(version), 0) + 1, 1000, 10000, 20, now(), 'KEEP_EXISTING', 'APPROVED', now(), (SELECT id FROM "User" WHERE email = 'owner@proguzellik.local')
      FROM "PlanPrice" WHERE "planCode" = 'SMART' HAVING NOT bool_or(status = 'APPROVED') OR count(*) = 0`);
    await page.goto("/panel/abonelik");
    await expect(page.getByText(/Deneme süresinden/)).toBeVisible();
    // Paket açıkça seçilir: testte oluşturulan (özellikleri kısıtlı) paketler demo salona atanmasın
    const smart = page.locator("div").filter({ has: page.getByText("Akıllı", { exact: true }) }).filter({ has: page.getByRole("button", { name: /^(Seç|Yenile)$/ }) }).last();
    await smart.getByRole("button", { name: /^(Seç|Yenile)$/ }).click();
    const dlg = page.getByRole("dialog");
    await expect(dlg.getByText(/gerçek ödeme alınmaz/)).toBeVisible();
    await dlg.getByLabel(/Test ödeme belirteci/).fill("tok_fail");
    await dlg.getByRole("button", { name: /Test ödemesiyle etkinleştir/ }).click();
    await expect(dlg.getByText("Kart reddedildi (test)")).toBeVisible();
    await dlg.getByLabel(/Test ödeme belirteci/).fill("tok_test");
    await dlg.getByLabel("Ödeme dönemi").selectOption("MONTHLY");
    await dlg.getByRole("button", { name: /Test ödemesiyle etkinleştir/ }).click();
    await expectToast(page, "Abonelik etkinleştirildi");
    // Tahsilat KDV dahil (1.000 + %20); abonelik fiyatı kilitlenir
    await expect(page.getByRole("row").filter({ hasText: "Ödendi" }).first()).toContainText("₺1.200,00");
    await expect(page.getByText(/Abonelik fiyatınız: ₺1\.000,00/)).toBeVisible();
    const sub = await apiGet<{ status: string }>(page, "/subscription");
    expect(sub.status).toBe("ACTIVE");
  });
});

test.describe("SaaS sahibi paneli", () => {
  test.use({ storageState: authFile("platform") });

  test("istatistikler, işletme listesi, pasife alma ve geri açma", async ({ page, browser }) => {
    await page.goto("/platform");
    await expect(page.getByText("MRR (aylık gelir)")).toBeVisible();
    const row = page.getByRole("row").filter({ hasText: "Örnek Kuaför" });
    await expect(row).toContainText("kuafor@proguzellik.local");
    await row.getByRole("button", { name: "Yönet" }).click();
    const dlg = page.getByRole("dialog");
    await dlg.getByRole("button", { name: "Pasife al" }).click();
    await dlg.getByLabel("Pasife alma gerekçesi").fill("E2E test");
    await dlg.getByRole("button", { name: "Pasife al" }).click();
    await expectToast(page, "İşletme pasife alındı");
    await expect(dlg).toContainText("Pasif: E2E test");
    await expect(row).toContainText("Askıda");

    const ctx = await browser.newContext({ storageState: authFile("other") });
    const p2 = await ctx.newPage();
    const res = await p2.request.get("/api/p/customers");
    expect(res.status()).toBe(403);

    await dlg.getByRole("button", { name: "Aktifleştir" }).click();
    await expectToast(page, "İşletme aktifleştirildi");
    await expect(row).not.toContainText("Askıda");
    expect((await p2.request.get("/api/p/customers")).status()).toBe(200);
    await ctx.close();
  });

  test("yeni güzellik merkezi oluşturulur, sahip daveti kabul eder ve yalnızca kendi işletmesini görür", async ({ page, browser }) => {
    const name = uniq("Davetli Salon");
    const email = `${uniq("davet").replace(" ", "-")}@ornek.test`;
    await page.goto("/platform");
    await page.getByRole("button", { name: "Yeni işletme" }).click();
    const dlg = page.getByRole("dialog");
    await dlg.getByLabel("İşletme adı").fill(name);
    await dlg.getByLabel("Sahip adı soyadı").fill("Davetli Sahip");
    await dlg.getByLabel("Sahip e-postası").fill(email);
    await dlg.getByLabel("Paket").selectOption("STARTER");
    await dlg.getByLabel("Deneme süresi (gün)").fill("21");
    await dlg.getByRole("button", { name: "Oluştur ve davet et" }).click();
    await expectToast(page, /oluşturuldu\. Davet e-postası gönderildi/);

    await page.getByLabel("İşletme ara").fill(name.split(" ").pop()!);
    const row = page.getByRole("row").filter({ hasText: name });
    await expect(row).toContainText("Başlangıç");
    await expect(row).toContainText("Davet gönderildi");
    await row.getByRole("button", { name: "Yönet" }).click();
    // Bağlantı panelde gösterilmez
    await expect(page.getByRole("dialog")).not.toContainText("token=");
    await page.getByRole("dialog").getByRole("button", { name: "Kapat" }).click();

    // Bağlantı yalnızca e-postada (test sağlayıcısının kaydı)
    const body = lastEmail(email, `${name} – ProGüzellik davetiniz`);
    const link = /https?:\/\/\S+\/davet\?token=[A-Za-z0-9_-]+/.exec(body)![0];
    const path = new URL(link).pathname + new URL(link).search;

    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const p2 = await ctx.newPage();
    await p2.goto(path);
    await expect(p2.getByText(`${name} işletmesinin yöneticisi`)).toBeVisible();
    await expect(p2).toHaveURL(/\/davet$/); // belirteç adres çubuğundan kaldırılır
    await p2.getByLabel("Parola", { exact: true }).fill("DavetParola2026");
    await p2.getByLabel("Parola (tekrar)").fill("DavetParola2026");
    await p2.getByRole("checkbox").check();
    await p2.getByRole("button", { name: "Daveti kabul et" }).click();
    await expect(p2).toHaveURL(/\/panel/);
    await expect(p2.getByText(name).first()).toBeVisible();
    const me = await (await p2.request.get("/api/p/auth/me")).json();
    expect(me.memberships.map((m: { tenant: { name: string } }) => m.tenant.name)).toEqual([name]);
    // Bağlantı ikinci kez kullanılamaz
    const ctx3 = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const p3 = await ctx3.newPage();
    await p3.goto(path);
    await expect(p3.getByText(/geçersiz veya süresi dolmuş/)).toBeVisible();
    await ctx3.close();
    await ctx.close();

    await page.reload();
    await page.getByLabel("İşletme ara").fill(name.split(" ").pop()!);
    await expect(page.getByRole("row").filter({ hasText: name })).toContainText(email);
  });

  test("paket fiyatı: taslak sitede görünmez; parola + 2FA ile onaylanınca KDV hariç yayımlanır ve geçmişte kalır", async ({ page, browser }) => {
    const code = `FIYAT_${Date.now().toString(36).toUpperCase()}`;
    const name = `Fiyat ${code.slice(-5)}`;
    await page.goto("/platform");
    // Paket: açıklama, sınırlar, satışta
    await page.getByRole("tab", { name: "Paketler" }).click();
    await page.getByRole("button", { name: "Yeni paket" }).click();
    const pd = page.getByRole("dialog");
    await pd.getByLabel("Paket kodu").fill(code);
    await pd.getByLabel("Paket adı").fill(name);
    await pd.getByLabel("Açıklama").fill("E2E fiyat paketi açıklaması");
    await pd.getByLabel("Personel sınırı").fill("4");
    await pd.getByLabel("Müşteri sınırı").fill("250");
    await expect(pd.getByLabel("Aylık (₺)")).toHaveCount(0);
    await pd.getByLabel(/Satışta/).check();
    await pd.getByRole("button", { name: "Kaydet" }).click();
    await expectToast(page, "Paket oluşturuldu");
    const row = page.locator(`tr[data-plan="${code}"]`);
    await expect(row).toContainText("Onaylı fiyat yok");
    await expect(row).toContainText("250 müşteri");
    await expect(row).toContainText("Satışta");

    // Taslak
    await row.getByRole("button", { name: "Fiyatlar" }).click();
    const fd = page.getByRole("dialog", { name: `${name} · fiyat yönetimi` });
    await expect(fd.getByText("Henüz fiyat girilmedi")).toBeVisible();
    const form = fd.getByRole("form", { name: "Yeni fiyat taslağı" });
    await form.getByLabel("Aylık (₺, KDV hariç)").fill("1250");
    await form.getByLabel("Yıllık (₺, KDV hariç)").fill("12500");
    await form.getByLabel("KDV oranı (%)").fill("20");
    // İleri tarih seçilince açık uyarı; boş bırakılırsa onay anında yürürlüğe girer
    const startField = form.getByLabel(/Başlangıç tarihi/);
    await startField.fill("2099-12-31T10:00");
    await expect(form.getByText(/İleri tarih seçtiniz/)).toBeVisible();
    await startField.fill("");
    await expect(form.getByText(/İleri tarih seçtiniz/)).toHaveCount(0);
    await form.getByRole("button", { name: "Taslak olarak kaydet" }).click();
    await expectToast(page, /Fiyat taslağı kaydedildi/);
    await expect(fd.locator('[data-price-status="DRAFT"]')).toContainText("₺1.250,00");

    // Taslak sitede görünmez
    const site = await browser.newContext();
    const sp = await site.newPage();
    await sp.goto("/fiyatlar");
    const card = sp.locator(`article[data-plan="${code}"]`);
    await expect(card).toContainText("Fiyat yakında");
    await expect(card).toContainText("E2E fiyat paketi açıklaması");
    await expect(card).not.toContainText("₺");

    // Yanlış kod reddedilir, doğru parola + 2FA ile onaylanır
    await fd.locator('[data-price-status="DRAFT"]').getByRole("button", { name: "Onayla" }).click();
    const ad = page.getByRole("dialog", { name: "Fiyatı onayla" });
    await expect(ad).toContainText("tanıtım sitesinde yayımlanır");
    await expect(ad).toContainText("Onay anında yürürlüğe girer");
    await ad.getByLabel("Parolanız").fill(PASSWORD);
    await ad.getByLabel("2FA doğrulama kodu").fill("000000");
    await ad.getByRole("button", { name: "Onayla ve yayımla" }).click();
    await expectToast(page, /hatalı/);
    resetTotpReplay("owner@proguzellik.local");
    await ad.getByLabel("2FA doğrulama kodu").fill(totp(readFileSync(".auth/platform-secret.txt", "utf8").trim()));
    await ad.getByRole("button", { name: "Onayla ve yayımla" }).click();
    await expectToast(page, "Fiyat onaylandı");
    const approved = fd.locator('[data-price-status="APPROVED"]');
    await expect(approved).toContainText("s1");
    await expect(approved).toContainText("Yürürlükte");
    await expect(approved).toContainText("Onaylayan: owner@proguzellik.local");
    await expect(approved.getByRole("button", { name: "İptal et" })).toHaveCount(0);
    await fd.getByRole("button", { name: "Kapat" }).click();
    await expect(row).toContainText("₺1.250,00");
    await expect(row).toContainText("%20 KDV");

    // Sitede KDV hariç ve oranıyla görünür
    await sp.reload();
    await expect(card).toContainText("₺1.250,00");
    await expect(card).toContainText("Yıllık: ₺12.500,00 + KDV");
    await expect(card).toContainText("Fiyatlara KDV dahil değildir; %20 KDV eklenir.");

    // Gizlenince sitede listelenmez
    await row.getByRole("button", { name: "Düzenle" }).click();
    await page.getByRole("dialog").getByLabel(/Satışta/).uncheck();
    await page.getByRole("dialog").getByRole("button", { name: "Kaydet" }).click();
    await expectToast(page, "Paket güncellendi");
    await expect(row).toContainText("Gizli");
    await sp.reload();
    await expect(sp.locator(`article[data-plan="${code}"]`)).toHaveCount(0);
    await site.close();
  });

  test("yeni paket oluşturulur, deneme süresi uzatılır, abonelikler sekmesinde izlenir", async ({ page }) => {
    const code = `E2E_${Date.now().toString(36).toUpperCase()}`;
    await page.goto("/platform");
    await page.getByRole("tab", { name: "Paketler" }).click();
    await page.getByRole("button", { name: "Yeni paket" }).click();
    const pd = page.getByRole("dialog");
    await pd.getByLabel("Paket kodu").fill(code);
    await pd.getByLabel("Paket adı").fill(`Paket ${code}`);
    await pd.getByLabel("Personel sınırı").fill("12");
    await pd.getByLabel("Raporlar").check();
    await pd.getByRole("button", { name: "Kaydet" }).click();
    await expectToast(page, "Paket oluşturuldu");
    await expect(page.getByRole("row").filter({ hasText: code })).toContainText("Raporlar");

    const name = uniq("Deneme Salon");
    const created = await page.request.post("/api/p/platform/tenants", {
      data: { name, ownerName: "Deneme Sahip", ownerEmail: `${uniq("deneme").replace(" ", "-")}@ornek.test`, planCode: code, trialDays: 5 },
    });
    expect(created.status()).toBe(201);
    await page.goto("/platform");
    await page.getByLabel("İşletme ara").fill(name.split(" ").pop()!);
    const row = page.getByRole("row").filter({ hasText: name });
    await expect(row).toContainText(`Paket ${code}`);
    await row.getByRole("button", { name: "Yönet" }).click();
    const dlg = page.getByRole("dialog");
    await dlg.getByLabel("Uzatılacak gün").fill("10");
    await dlg.getByLabel("Gerekçe", { exact: true }).fill("E2E kurulum desteği");
    await dlg.getByRole("button", { name: "Süreyi uzat" }).click();
    await expectToast(page, "Deneme süresi uzatıldı");
    const end = new Date(Date.now() + 15 * 86_400_000).toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Istanbul" });
    await expect(dlg.getByText(end)).toBeVisible();
    await dlg.getByRole("button", { name: "Kapat" }).click();

    await page.getByRole("tab", { name: "Abonelikler" }).click();
    await expect(page.getByText("Deneme", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "Abonelikler" })).toBeVisible();
  });

  test("finans: şirket ayarı, cari hesap, kısmi tahsilat, fatura taslağı ve entegratörsüz kesim engeli", async ({ page }) => {
    const name = uniq("Finans Salon");
    const created = await page.request.post("/api/p/platform/tenants", {
      data: { name, ownerName: "Finans Sahip", ownerEmail: `${uniq("finans").replace(" ", "-")}@ornek.test`, planCode: "STARTER", trialDays: 14 },
    });
    expect(created.status()).toBe(201);
    const tenantId = (await created.json()).tenant?.id ?? (await created.json()).id;

    await page.goto("/platform");
    await page.getByRole("tab", { name: "Şirket ayarları" }).click();
    await expect(page.getByText(/SMTP yapılandırılmadı|SMTP yapılandırıldı/)).toBeVisible();
    await expect(page.getByText(/Yetkili entegratör bağlı değil/)).toBeVisible();
    await page.getByLabel("Şirket unvanı").fill("E2E Yazılım A.Ş.");
    await page.getByLabel("VKN").fill("1234567890");
    await page.getByLabel("Vergi dairesi").fill("Kadıköy");
    await page.getByLabel("Adres").fill("İstanbul");
    await page.getByLabel("KDV oranı (%)").fill("20");
    await page.getByLabel("Paket fiyatları").selectOption("1");
    await page.getByRole("button", { name: "Kaydet" }).click();
    await expectToast(page, "Şirket ayarları kaydedildi");

    await page.getByRole("tab", { name: "Finans" }).click();
    await page.getByLabel("Cari hesap aç").selectOption({ label: name });
    await page.getByRole("button", { name: "Cari hesabı aç" }).click();
    const dlg = page.getByRole("dialog");
    await dlg.getByRole("button", { name: "Tahakkuk ekle" }).click();
    await dlg.getByLabel("Tutar (₺)").fill("1200");
    await dlg.getByLabel("Açıklama").fill("Kasım aboneliği");
    await dlg.getByRole("button", { name: "Kaydet" }).click();
    await expectToast(page, "Kayıt eklendi");
    const accRow = dlg.getByRole("row").filter({ hasText: "Kasım aboneliği" }).first();
    await accRow.getByRole("button", { name: "Tahsilat" }).click();
    await dlg.getByLabel("Tutar (₺)").fill("500");
    await dlg.getByRole("button", { name: "Kaydet" }).click();
    await expectToast(page, "Kayıt eklendi");
    await expect(dlg.getByRole("row").filter({ hasText: "Kısmi tahsil" })).toContainText("Kalan ₺700,00");

    await dlg.getByRole("button", { name: "Düzenle" }).click();
    await dlg.getByLabel("Unvan").fill(`${name} Ltd.`);
    await dlg.getByRole("button", { name: "Kaydet" }).click();
    await expectToast(page, "Fatura bilgileri kaydedildi");
    const popup = page.waitForEvent("popup");
    await dlg.getByRole("row").filter({ hasText: "Kısmi tahsil" }).getByRole("button", { name: "Fatura taslağı" }).click();
    const inv = await popup;
    await expect(inv.getByText("TASLAK – Bu belge resmî fatura değildir, mali değeri yoktur.")).toBeVisible();
    await expect(inv.getByText("₺1.000,00").first()).toBeVisible();
    await inv.getByRole("button", { name: "e-Fatura/e-Arşiv olarak düzenle" }).click();
    await expect(inv.getByText(/entegratörü yapılandırılmadı; resmî fatura kesilmedi/)).toBeVisible();
    await expect(inv.getByText("Taslak (mali değeri yok)")).toBeVisible();
    await inv.close();
    void tenantId;
  });

  test("e-postalar: şablon düzenleme/önizleme, tek işletmeye bilgilendirme ve gönderim geçmişi", async ({ page }) => {
    const name = uniq("Eposta Salon");
    const email = `${uniq("eposta").replace(" ", "-")}@ornek.test`;
    const created = await page.request.post("/api/p/platform/tenants", { data: { name, ownerName: "Eposta Sahip", ownerEmail: email, planCode: "STARTER", trialDays: 14 } });
    expect(created.status()).toBe(201);

    await page.goto("/platform");
    await page.getByRole("tab", { name: "E-postalar" }).click();
    const templates = page.getByRole("region", { name: "E-posta şablonları" });
    const tpl = templates.getByRole("row").filter({ hasText: "Ödeme hatırlatması" });
    await tpl.getByRole("button", { name: "Düzenle" }).click();
    const dlg = page.getByRole("dialog");
    await dlg.getByLabel("Konu").fill("Hatırlatma: {salon} {yok}");
    await dlg.getByRole("button", { name: "Kaydet" }).click();
    await expect(dlg.getByText(/Bilinmeyen değişken: \{yok\}/)).toBeVisible();
    await dlg.getByLabel("Konu").fill("Hatırlatma: {salon}");
    await dlg.getByRole("button", { name: "Önizle" }).click();
    await expect(dlg.getByText("Hatırlatma: Örnek Güzellik").first()).toBeVisible();
    await dlg.getByRole("button", { name: "Kaydet" }).click();
    await expectToast(page, "Şablon kaydedildi");
    await expect(tpl).toContainText("Özelleştirildi");
    await tpl.getByRole("button", { name: "Düzenle" }).click();
    await dlg.getByRole("button", { name: "Varsayılana dön" }).click();
    await expectToast(page, "Varsayılan metne dönüldü");
    await expect(tpl).toContainText("Varsayılan");
    await expect(templates.getByRole("row").filter({ hasText: "Parola sıfırlama" })).toContainText("Sabit");

    await page.getByRole("button", { name: "Bilgilendirme gönder" }).click();
    await expect(dlg.getByText(/İYS onayı/)).toBeVisible();
    // Sahibi daveti henüz kabul etmemiş işletmeye gönderilemez
    await dlg.getByLabel("İşletme").selectOption({ label: name });
    await dlg.getByLabel("Konu").fill("Planlı bakım");
    await dlg.getByLabel("Mesaj").fill("Pazar 02:00-03:00 arasında kısa bir bakım yapılacaktır.");
    await dlg.getByLabel(/ticari ileti değildir/).check();
    await dlg.getByRole("button", { name: "Gönder" }).click();
    await expect(dlg.getByText("Seçime uyan aktif işletme sahibi yok")).toBeVisible();
    await dlg.getByLabel(/ticari ileti değildir/).uncheck();
    const subject = uniq("Planlı bakım");
    await dlg.getByLabel("İşletme").selectOption({ label: "Örnek Kuaför" });
    await dlg.getByLabel("Konu").fill(subject);
    await dlg.getByLabel("Mesaj").fill("Pazar 02:00-03:00 arasında kısa bir bakım yapılacaktır.");
    await expect(dlg.getByRole("button", { name: "Gönder" })).toBeDisabled();
    await dlg.getByLabel(/ticari ileti değildir/).check();
    await dlg.getByRole("button", { name: "Gönder" }).click();
    await expectToast(page, "1 gönderildi");
    await expect(page.getByRole("row").filter({ hasText: subject })).toContainText("Gönderildi");
  });

  test("manuel abonelik: ücretsiz oluşturma, süre uzatma ve dönem sonu iptali; tahsilattan ayrı listelenir", async ({ page }) => {
    const name = uniq("Manuel Salon");
    const created = await page.request.post("/api/p/platform/tenants", {
      data: { name, ownerName: "Manuel Sahip", ownerEmail: `${uniq("manuel").replace(" ", "-")}@ornek.test`, planCode: "STARTER", trialDays: 14 },
    });
    expect(created.status()).toBe(201);
    await page.goto("/platform");
    await page.getByLabel("İşletme ara").fill(name.split(" ").pop()!);
    const row = page.getByRole("row").filter({ hasText: name });
    await row.getByRole("button", { name: "Yönet" }).click();
    const dlg = page.getByRole("dialog");
    await expect(dlg.getByText(/Açık abonelik yok/)).toBeVisible();
    await dlg.getByRole("button", { name: "Manuel abonelik oluştur" }).click();
    const form = dlg.locator("form").filter({ has: page.getByRole("button", { name: "Oluştur", exact: true }) });
    await form.getByLabel("Paket").selectOption("SMART");
    await form.getByLabel("Dönem").selectOption("YEARLY");
    await form.getByLabel(/Açıklama/).fill("E2E açılış hediyesi");
    await form.getByRole("button", { name: "Oluştur", exact: true }).click();
    await expectToast(page, "Manuel abonelik oluşturuldu");
    await expect(dlg.getByText("Manuel · ücretsiz")).toBeVisible();
    await expect(dlg.getByRole("row").filter({ hasText: "E2E açılış hediyesi" })).toContainText("Ücretsiz");
    await expect(dlg.getByText("Tahsilat yok")).toBeVisible();
    await expect(row).toContainText("Aktif");
    await expect(row).toContainText("Akıllı");

    await dlg.getByRole("button", { name: "Süre uzat" }).click();
    await dlg.getByLabel("Eklenecek gün").fill("10");
    await dlg.getByLabel(/Açıklama/).fill("E2E telafi");
    await dlg.getByRole("button", { name: "Uzat", exact: true }).click();
    await expectToast(page, "Süre uzatıldı");
    await expect(dlg.getByRole("row").filter({ hasText: "E2E telafi" })).toContainText("Süre uzatıldı");

    await dlg.getByRole("button", { name: "İptal et" }).click();
    await dlg.getByLabel(/Açıklama/).fill("E2E iptal");
    await dlg.getByRole("button", { name: "İptal et" }).click();
    await expectToast(page, "Abonelik iptal edildi");
    await expect(dlg.getByText(/dönem sonunda iptal edilecek/)).toBeVisible();
  });

  test("kullanıcı yönetimi: personel daveti, parola belirleme, rol değiştirme, erişim kapatma ve sıfırlama", async ({ page, browser }) => {
    const name = uniq("Ekip Salon");
    const email = `${uniq("personel").replace(" ", "-")}@ornek.test`;
    const created = await page.request.post("/api/p/platform/tenants", {
      data: { name, ownerName: "Ekip Sahibi", ownerEmail: `${uniq("ekipsahip").replace(" ", "-")}@ornek.test`, planCode: "PROFESSIONAL", trialDays: 14 },
    });
    expect(created.status()).toBe(201);
    const tenantId = (await created.json()).tenant.id as string;

    // İşletme detayından personel daveti
    await page.goto("/platform");
    await page.getByLabel("İşletme ara").fill(name.split(" ").pop()!);
    await page.getByRole("row").filter({ hasText: name }).getByRole("button", { name: "Yönet" }).click();
    const dlg = page.getByRole("dialog");
    await dlg.getByRole("button", { name: "Kullanıcı davet et" }).click();
    await dlg.getByLabel("Ad soyad").fill("Ekip Personeli");
    await dlg.getByLabel("E-posta").fill(email);
    await dlg.getByLabel("Rol").selectOption("STAFF");
    await dlg.getByRole("button", { name: "Davet et" }).click();
    await expectToast(page, "Davet e-postası gönderildi");
    await expect(dlg.getByText(email)).toBeVisible();
    await dlg.getByRole("button", { name: "Kapat" }).click();

    // Davetli parolasını kendisi belirler
    const body = lastEmail(email, `${name} – ProGüzellik davetiniz`);
    expect(body).toMatch(/personel olarak/);
    const link = new URL(/https?:\/\/\S+\/davet\?token=[A-Za-z0-9_-]+/.exec(body)![0]);
    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const p2 = await ctx.newPage();
    await p2.goto(link.pathname + link.search);
    await expect(p2.getByText(/işletmesine personel olarak davet edildiniz/)).toBeVisible();
    await p2.getByLabel("Parola", { exact: true }).fill("EkipParola2026");
    await p2.getByLabel("Parola (tekrar)").fill("EkipParola2026");
    await p2.getByRole("checkbox").check();
    await p2.getByRole("button", { name: "Daveti kabul et" }).click();
    await expect(p2).toHaveURL(/\/panel/);
    const asStaff = (path: string) => p2.request.get(`/api/p${path}`, { headers: { "X-Tenant-Id": tenantId } });
    expect((await asStaff("/customers")).status()).toBe(200);

    // Kullanıcılar sekmesi: arama, rol değiştirme, erişim kapatma, sıfırlama
    await page.getByRole("tab", { name: "Kullanıcılar" }).click();
    await page.getByLabel("Kullanıcı ara").fill(email);
    const row = page.getByRole("row").filter({ hasText: email });
    await expect(row).toContainText(`${name} · Personel`);
    await row.getByRole("button", { name: "Yönet" }).click();
    const udlg = page.getByRole("dialog");
    await udlg.getByLabel(`${name} rolü`).selectOption("RECEPTION");
    await expectToast(page, "Rol güncellendi");
    await expect(row).toContainText(`${name} · Resepsiyon`);
    await udlg.getByRole("button", { name: "Erişimi kapat" }).click();
    await expectToast(page, "İşletme erişimi kapatıldı");
    await expect(udlg.getByText("Erişim kapalı")).toBeVisible();
    expect((await asStaff("/customers")).status()).toBe(403);
    await udlg.getByRole("button", { name: "Erişimi aç" }).click();
    await expectToast(page, "İşletme erişimi açıldı");
    expect((await asStaff("/customers")).status()).toBe(200);
    await udlg.getByRole("button", { name: "Parola sıfırlama bağlantısı gönder" }).click();
    await expectToast(page, "Sıfırlama bağlantısı e-postayla gönderildi");
    expect(lastEmail(email, "Parola sıfırlama")).toMatch(/parola-sifirla\?token=/);
    await expect(udlg.getByRole("row").filter({ hasText: "Rol değiştirildi" })).toBeVisible();
    await ctx.close();
  });

  test("işletme sahibi /platform sayfasına erişemez; eski /yonetim adresi yönlendirilir", async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: authFile("owner") });
    const p = await ctx.newPage();
    await p.goto("/platform");
    await expect(p).toHaveURL(/\/panel$/);
    await p.goto("/yonetim/fatura/00000000-0000-0000-0000-000000000000");
    await expect(p).toHaveURL(/\/panel$/);
    expect((await p.request.get("/api/p/platform/stats")).status()).toBe(403);
    await ctx.close();
  });
});

test("ücretsiz deneme: başvuru → e-posta doğrulama → 7 günlük deneme ile panel açılır", async ({ page }) => {
  const email = `${uniq("kayit").replace(" ", "-")}@proguzellik.local`;
  await page.goto("/kayit?paket=STARTER");
  await expect(page).toHaveURL(/\/ucretsiz-deneme\?paket=STARTER/);
  await expect(page.getByLabel("Paket")).toHaveValue("STARTER");
  await submitTrialForm(page, { business: uniq("E2E Salon"), name: "Test Sahip", email, password: PASSWORD });
  // Doğrulamadan önce hesap yoktur
  expect(sql(`SELECT count(*) FROM "User" WHERE email='${email}'`)).toBe("0");
  const body = lastEmail(email, "Ücretsiz denemenizi başlatmak için e-postanızı doğrulayın");
  const link = /(\/ucretsiz-deneme\/dogrula\?token=[A-Za-z0-9_-]+)/.exec(body)?.[1] ?? "";
  await page.goto(link);
  await page.getByRole("button", { name: "E-postamı doğrula ve denemeyi başlat" }).click();
  await expect(page).toHaveURL(/\/panel/);
  await expect(page.getByText(/Deneme sürenizin bitmesine/)).toContainText("7 gün");
  await expect(page.getByText("E-posta adresiniz henüz doğrulanmadı.")).toHaveCount(0);
  await login(page, email);
});
