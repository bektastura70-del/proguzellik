import { execSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { apiEnv, E2E_PSQL } from "../env";
import { apiGet, authFile, expectToast } from "./helpers";

/**
 * Yenilenme hatırlatması (E2E ortamında RENEWAL_REMINDERS=1): hizmette tekrar süresi + hatırlatma günü,
 * işletme ayarı, "Yaklaşan yenilemeler" listesi, listeden randevu ve e-postadaki vazgeçme sayfası.
 * Gönderim (kuyruk/e-posta) API testlerinde doğrulanır; burada gerçek gönderim yoktur.
 */
const SLUG = "isilti-guzellik";
const sql = (q: string) => execSync(E2E_PSQL, { input: q, encoding: "utf8" }).trim();
const SHOTS = process.env.SHOTS_DIR;

test.use({ storageState: authFile("owner") });

test.describe.serial("Yenilenme hatırlatması", () => {
  // E2E veritabanı her çalıştırmada yeniden kurulur; adlar ekran görüntülerinde okunaklı olsun diye sabittir.
  const svc = "Saç Boyama";
  let tenantId = "";
  let consentId = "";

  test("hizmete tekrar süresi ve hatırlatma günü girilir; hatalı değer reddedilir", async ({ page }) => {
    tenantId = sql(`SELECT id FROM "Tenant" WHERE slug='${SLUG}'`);
    await page.goto("/panel/hizmetler");
    await page.getByRole("button", { name: "Hizmet" }).click();
    const dlg = page.getByRole("dialog", { name: "Yeni hizmet" });
    await dlg.getByLabel("Hizmet adı").fill(svc);
    await dlg.getByLabel("Süre (dk)").fill("90");
    await dlg.getByLabel("Fiyat (₺)").fill("1500");
    await dlg.getByLabel("Tekrar süresi (gün)").fill("45");
    await dlg.getByLabel("Kaç gün önce hatırlatılsın").fill("45");
    await dlg.getByRole("button", { name: "Kaydet" }).click();
    await expect(dlg.getByText("Hatırlatma günü, tekrar süresinden kısa olmalı")).toBeVisible();
    await dlg.getByLabel("Kaç gün önce hatırlatılsın").fill("7");
    if (SHOTS) await dlg.screenshot({ path: `${SHOTS}/1-hizmet-ayari.png` });
    await dlg.getByRole("button", { name: "Kaydet" }).click();
    await expectToast(page, "Hizmet kaydedildi");
    const services = await apiGet<{ name: string; rebookAfterDays: number; renewalRemindDaysBefore: number }[]>(page, "/services");
    expect(services.find((s) => s.name === svc)).toMatchObject({ rebookAfterDays: 45, renewalRemindDaysBefore: 7 });
  });

  test("işletme ayarından açılır (varsayılan kapalı)", async ({ page }) => {
    await page.goto("/panel/ayarlar");
    const box = page.getByLabel("Müşterilere yenilenme hatırlatması gönder");
    await expect(box).not.toBeChecked();
    await box.check();
    await expectToast(page, "Yenilenme hatırlatması açıldı");
    await page.reload();
    await expect(page.getByLabel("Müşterilere yenilenme hatırlatması gönder")).toBeChecked();
    expect(sql(`SELECT count(*) FROM "AuditLog" WHERE "tenantId"='${tenantId}' AND action='tenant.renewal_reminders_changed'`)).not.toBe("0");
  });

  test("yaklaşan yenilemeler listesi: durumlar, arama ve listeden randevu", async ({ page }) => {
    // Geçmiş tarihli tamamlanmış işlemler arayüzden girilemez; test verisi doğrudan yazılır.
    const sid = sql(`SELECT id FROM "Service" WHERE "tenantId"='${tenantId}' AND name='${svc}'`);
    const staff = sql(`SELECT id FROM "StaffMember" WHERE "tenantId"='${tenantId}' ORDER BY "createdAt" LIMIT 1`);
    const mk = (first: string, last: string, phone: string, consent: boolean, daysAgo: number, hour: number) => {
      const cid = sql(`INSERT INTO "Customer" (id,"tenantId","firstName","lastName",phone,email,"marketingConsent","kvkkConsentAt","updatedAt")
        VALUES (gen_random_uuid(),'${tenantId}','${first}','${last}','${phone}','${first.toLowerCase()}.${phone}@musteri.test',${consent},now(),now()) RETURNING id`).split("\n")[0];
      sql(`INSERT INTO "Appointment" (id,"tenantId","customerId","staffId","serviceId","startsAt","endsAt",status,price,"updatedAt")
        VALUES (gen_random_uuid(),'${tenantId}','${cid}','${staff}','${sid}', date_trunc('day', now()) - interval '${daysAgo} days' + interval '${hour} hours', date_trunc('day', now()) - interval '${daysAgo} days' + interval '${hour} hours 30 minutes','COMPLETED',1500,now())`);
      return cid;
    };
    const p = () => `055${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
    consentId = mk("Deniz", "Aydın", p(), true, 41, 7);
    mk("Burcu", "Şahin", p(), false, 40, 8);
    mk("Selin", "Koç", p(), true, 30, 9);
    mk("Gamze", "Yıldız", p(), true, 50, 10);

    await page.goto("/panel/yenilemeler");
    await expect(page.getByRole("heading", { name: "Yaklaşan yenilemeler" })).toBeVisible();
    const row = (n: string) => page.getByRole("row").filter({ hasText: n });
    await expect(row("Deniz Aydın")).toContainText(svc);
    await expect(row("Deniz Aydın")).toContainText("4 gün kaldı");
    await expect(row("Deniz Aydın")).toContainText("Gönderilecek");
    await expect(row("Burcu Şahin")).toContainText("İleti izni yok, arayın");
    await expect(row("Selin Koç")).toContainText("Hatırlatma günü bekleniyor");
    await expect(row("Gamze Yıldız")).toContainText("Süre doldu, arayın");
    await expect(row("Burcu Şahin").getByRole("link", { name: /ara$/ })).toHaveAttribute("href", /^tel:055/);
    if (SHOTS) {
      mkdirSync(SHOTS, { recursive: true });
      await page.screenshot({ path: `${SHOTS}/2-yaklasan-yenilemeler.png`, fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(page.getByText("Deniz Aydın").first()).toBeVisible();
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${SHOTS}/2b-yaklasan-yenilemeler-telefon.png`, fullPage: true });
      await page.setViewportSize({ width: 1440, height: 900 });
    }

    await row("Deniz Aydın").getByRole("link", { name: "Randevu" }).click();
    await page.waitForURL(/\/panel\/takvim\?yeni=1/);
    const dlg = page.getByRole("dialog", { name: "Yeni randevu" });
    await expect(dlg.getByText("Deniz Aydın")).toBeVisible();
    await expect(dlg.getByLabel("Hizmet")).toHaveValue(sid);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/3-listeden-randevu.png` });
  });

  test("e-postadaki bağlantı: sayfayı açmak değiştirmez, düğmeyle hatırlatmalar kapanır", async ({ page }) => {
    const sig = createHmac("sha256", apiEnv.JWT_SECRET).update(`renewal-optout:${tenantId}:${consentId}`).digest("base64url");
    const token = `${tenantId}.${consentId}.${sig}`;
    await page.goto(`/r/${SLUG}/hatirlatma-kapat?t=${encodeURIComponent(token)}`);
    await expect(page.getByRole("button", { name: "Hatırlatmaları kapat" })).toBeVisible();
    expect(sql(`SELECT "renewalRemindersOptOutAt" IS NULL FROM "Customer" WHERE id='${consentId}'`)).toBe("t");
    await page.getByRole("button", { name: "Hatırlatmaları kapat" }).click();
    await expect(page.getByText("yenileme hatırlatmaları sizin için kapatıldı")).toBeVisible();
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/4-vazgecme.png` });
    expect(sql(`SELECT "renewalRemindersOptOutAt" IS NOT NULL FROM "Customer" WHERE id='${consentId}'`)).toBe("t");

    await page.goto("/panel/yenilemeler");
    await expect(page.getByRole("row").filter({ hasText: "Deniz Aydın" })).toContainText("Hatırlatma istemiyor");
  });
});
