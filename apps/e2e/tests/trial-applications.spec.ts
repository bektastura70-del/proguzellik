import { expect, test } from "@playwright/test";
import { authFile, expectToast, uniq } from "./helpers";
import { lastEmail, sql } from "./totp";

const closed = process.env.REGISTRATION_ENABLED === "0";
/** İsteğe bağlı ekran görüntüleri (inceleme için): SHOT_DIR=/yol */
const shot = (p: import("@playwright/test").Page, name: string) => (process.env.SHOT_DIR ? p.screenshot({ path: `${process.env.SHOT_DIR}/${name}.png`, fullPage: true }) : Promise.resolve());

test.describe("Deneme başvurusu", () => {
  test("kayıt açıkken sayfa kendi kendine kayıt formunu gösterir; başvuru formu yoktur", async ({ page }) => {
    test.skip(closed, "Kayıt kapalı çalıştırmada geçerli değil");
    await page.goto("/ucretsiz-deneme");
    await expect(page.getByRole("button", { name: "Ücretsiz denemeyi başlat" })).toBeVisible();
    await expect(page.getByTestId("application-form")).toHaveCount(0);
  });

  test("kayıt kapalıyken: başvuru → e-posta doğrulama → SaaS sahibi önceden doldurulmuş kaydı onaylar", async ({ page, browser }) => {
    test.skip(!closed, "Yalnız REGISTRATION_ENABLED=0 ile çalışır");
    const salon = uniq("Başvuru Salon");
    const email = `${uniq("basvuru").replace(" ", "-")}@proguzellik.local`;

    await page.goto("/ucretsiz-deneme");
    await expect(page.getByRole("heading", { name: "14 gün ücretsiz deneme başvurusu" })).toBeVisible();
    await expect(page.getByTestId("registration-closed")).toHaveCount(0);
    await page.getByLabel("Salon adı").fill(salon);
    await page.getByLabel("Yetkili adı soyadı").fill("Başvuru Sahibi");
    await page.getByLabel("Telefon").fill(`05${String(Date.now()).slice(-9)}`);
    await page.getByLabel("E-posta").fill(email);
    await page.getByLabel("Şehir (isteğe bağlı)").fill("Bursa");
    await page.getByLabel("Personel sayısı (isteğe bağlı)").fill("3");
    await page.getByLabel("Notunuz (isteğe bağlı)").fill("Öğleden sonra arayın");
    await page.locator('input[name="kvkk"]').check();
    await page.locator('input[name="terms"]').check();
    await shot(page, "1-basvuru-formu");
    await page.getByRole("button", { name: "Deneme başvurusu gönder" }).click();
    await expect(page.getByTestId("application-sent")).toContainText(email);

    const link = /(\/ucretsiz-deneme\/basvuru-dogrula\?token=[A-Za-z0-9_-]+)/.exec(lastEmail(email, "Deneme başvurunuz için e-postanızı doğrulayın"))![1];
    await page.goto(link);
    await page.getByRole("button", { name: "E-postamı doğrula ve başvuruyu ilet" }).click();
    await expect(page.getByTestId("application-verified")).toBeVisible();

    const ctx = await browser.newContext({ storageState: authFile("platform") });
    const admin = await ctx.newPage();
    await admin.goto("/platform?sekme=basvurular");
    await expect(admin.getByRole("tab", { name: /Başvurular/ })).toHaveAttribute("aria-selected", "true");
    await expect(admin.getByTestId("pending-applications")).toBeVisible();
    const row = admin.getByTestId("application-row").filter({ hasText: salon });
    await expect(row).toContainText("Onay bekliyor");
    await shot(admin, "2-basvurular-sekmesi");
    await row.getByRole("button", { name: "İncele" }).click();
    const dlg = admin.getByRole("dialog");
    await expect(dlg.getByLabel("İşletme adı")).toHaveValue(salon);
    await expect(dlg.getByLabel("Sahip adı soyadı")).toHaveValue("Başvuru Sahibi");
    await expect(dlg.getByLabel("Sahip e-postası")).toHaveValue(email);
    await expect(dlg.getByLabel("Deneme süresi (gün)")).toHaveValue("14");
    await expect(dlg).toContainText("Öğleden sonra arayın");
    await shot(admin, "3-onay-penceresi");
    await dlg.getByRole("button", { name: "Onayla ve davet gönder" }).click();
    await expectToast(admin, /açıldı; sahibine davet e-postası gönderildi/);

    expect(sql(`SELECT status FROM "Tenant" WHERE name = '${salon}'`)).toBe("TRIAL");
    expect(sql(`SELECT a.status || ':' || (a."tenantId" IS NOT NULL) FROM "TrialApplication" a WHERE a.email = '${email}'`)).toBe("APPROVED:true");
    expect(lastEmail(email, `${salon} – ProGüzellik davetiniz`)).toMatch(/\/davet\?token=/);
    await ctx.close();
  });
});
