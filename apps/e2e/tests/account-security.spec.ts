import { expect, test } from "@playwright/test";
import { authFile, expectToast, uniq } from "./helpers";
import { lastEmail, resetTotpReplay, sql, totp } from "./totp";

const linkFrom = (body: string) => /(\/[a-z-]+\?token=[A-Za-z0-9_-]+)/.exec(body)?.[1] ?? "";

test.describe.serial("Hesap güvenliği: e-posta doğrulama, parola sıfırlama, 2FA, oturumlar", () => {
  const email = `${uniq("guvenlik").replace(" ", "-")}@proguzellik.local`;
  const pass1 = "IlkParola2026";
  const pass2 = "YeniParola2027";
  let secret = "";
  let recovery: string[] = [];

  test("kayıt → doğrulama e-postası → bağlantıyla e-posta doğrulanır", async ({ page }) => {
    await page.goto("/kayit");
    await page.getByLabel("Salon adı").fill(uniq("Güvenli Salon"));
    await page.getByLabel("Adınız soyadınız").fill("Güvenlik Testçisi");
    await page.getByLabel("E-posta").fill(email);
    await page.getByLabel("Parola", { exact: true }).fill(pass1);
    await page.getByLabel("Parola (tekrar)").fill(pass1);
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Ücretsiz denemeyi başlat" }).click();
    await expect(page).toHaveURL(/\/panel/);
    await expect(page.getByText("E-posta adresiniz henüz doğrulanmadı.")).toBeVisible();
    const body = lastEmail(email, "E-posta adresinizi doğrulayın");
    expect(body).toContain("/eposta-dogrula?token=");
    await page.goto(linkFrom(body));
    await expect(page.getByText("E-posta adresiniz doğrulandı.")).toBeVisible();
    await page.goto(linkFrom(body));
    await expect(page.getByText(/geçersiz veya süresi dolmuş/)).toBeVisible();
    await page.goto("/panel");
    await expect(page.getByRole("heading", { name: /Merhaba/ })).toBeVisible();
    await expect(page.getByText("E-posta adresiniz henüz doğrulanmadı.")).toHaveCount(0);
  });

  test("parolamı unuttum → e-postadaki bağlantı → yeni parola; eski oturum kapanır", async ({ page, browser }) => {
    const other = await browser.newContext();
    const op = await other.newPage();
    await op.goto("/giris");
    await op.getByLabel("E-posta").fill(email);
    await op.getByLabel("Parola").fill(pass1);
    await op.getByRole("button", { name: "Giriş yap" }).click();
    await expect(op).toHaveURL(/\/panel/);

    await page.goto("/giris");
    await page.getByRole("link", { name: "Parolamı unuttum" }).click();
    await expect(page.getByRole("heading", { name: "Parolanızı mı unuttunuz?" })).toBeVisible();
    await page.getByLabel("E-posta").fill(email);
    await page.getByRole("button", { name: "Sıfırlama bağlantısı gönder" }).click();
    await expect(page.getByText(/hesap varsa sıfırlama bağlantısı gönderildi/)).toBeVisible();
    const link = linkFrom(lastEmail(email, "Parola sıfırlama"));
    expect(link).toMatch(/^\/parola-sifirla\?token=/);
    await page.goto(link);
    await page.getByLabel("Yeni parola", { exact: true }).fill(pass2);
    await page.getByLabel("Yeni parola (tekrar)").fill(pass2);
    await page.getByRole("button", { name: "Parolayı güncelle" }).click();
    await expect(page).toHaveURL(/sifirlandi=1/);
    await expect(page.getByText("Parolanız güncellendi.")).toBeVisible();

    // Diğer cihazdaki oturum kapandı.
    expect((await op.request.get("/api/p/auth/me")).status()).toBe(401);
    await other.close();
    // Bağlantı tekrar kullanılamaz.
    await page.goto(link);
    await page.getByLabel("Yeni parola", { exact: true }).fill("BaskaParola2028");
    await page.getByLabel("Yeni parola (tekrar)").fill("BaskaParola2028");
    await page.getByRole("button", { name: "Parolayı güncelle" }).click();
    await expect(page.getByText(/geçersiz veya süresi dolmuş/)).toBeVisible();
    expect(sql(`SELECT count(*) FROM "OutboundEmail" WHERE "to"='${email}' AND subject='Parolanız değiştirildi'`)).toBe("1");
  });

  test("2FA etkinleştirilir; girişte kod istenir; yanlış kod reddedilir", async ({ page }) => {
    await page.goto("/giris");
    await page.getByLabel("E-posta").fill(email);
    await page.getByLabel("Parola").fill(pass2);
    await page.getByRole("button", { name: "Giriş yap" }).click();
    await expect(page).toHaveURL(/\/panel/);
    await page.getByRole("link", { name: "Hesap güvenliği" }).click();
    await page.getByRole("button", { name: /2FA'yı etkinleştir/ }).click();
    const dlg = page.getByRole("dialog");
    await dlg.getByLabel("Parolanızı doğrulayın").fill(pass2);
    await dlg.getByRole("button", { name: "Devam" }).click();
    secret = (await dlg.getByTestId("mfa-secret").textContent())!.trim();
    await dlg.getByLabel("Doğrulama kodu").fill("000000");
    await dlg.getByRole("button", { name: "Etkinleştir" }).click();
    await expect(dlg.getByText(/Doğrulama kodu hatalı/)).toBeVisible();
    await dlg.getByLabel("Doğrulama kodu").fill(totp(secret));
    await dlg.getByRole("button", { name: "Etkinleştir" }).click();
    await expect(dlg.getByTestId("recovery-codes").locator("li")).toHaveCount(10);
    recovery = await dlg.getByTestId("recovery-codes").locator("li").allTextContents();
    expect(recovery).toHaveLength(10);
    await dlg.getByRole("button", { name: "Kaydettim" }).click();
    await expect(page.getByText("Açık").first()).toBeVisible();

    await page.goto("about:blank");
    await page.request.post("/api/auth/logout");
    resetTotpReplay(email);
    await page.goto("/giris");
    await page.getByLabel("E-posta").fill(email);
    await page.getByLabel("Parola").fill(pass2);
    await page.getByRole("button", { name: "Giriş yap" }).click();
    await expect(page.getByLabel("Doğrulama kodu")).toBeVisible();
    await page.getByLabel("Doğrulama kodu").fill("111111");
    await page.getByRole("button", { name: "Doğrula ve giriş yap" }).click();
    await expect(page.getByText("Doğrulama kodu hatalı")).toBeVisible();
    await page.getByLabel("Doğrulama kodu").fill(totp(secret));
    await page.getByRole("button", { name: "Doğrula ve giriş yap" }).click();
    await expect(page).toHaveURL(/\/panel/);
  });

  test("kurtarma koduyla giriş; aynı kod ikinci kez çalışmaz", async ({ page }) => {
    for (const expectOk of [true, false]) {
      await page.goto("/giris");
      await page.getByLabel("E-posta").fill(email);
      await page.getByLabel("Parola").fill(pass2);
      await page.getByRole("button", { name: "Giriş yap" }).click();
      await page.getByRole("button", { name: /kurtarma kodu kullan/ }).click();
      await page.getByLabel("Kurtarma kodu").fill(recovery[0]);
      await page.getByRole("button", { name: "Doğrula ve giriş yap" }).click();
      if (expectOk) {
        await expect(page).toHaveURL(/\/panel/);
        await page.goto("about:blank");
        await page.request.post("/api/auth/logout");
      } else {
        await expect(page.getByText("Doğrulama kodu hatalı")).toBeVisible();
      }
    }
  });

  test("oturum listesi: başka cihazdaki oturum kapatılabilir", async ({ page, browser }) => {
    const other = await browser.newContext();
    const op = await other.newPage();
    resetTotpReplay(email);
    await op.goto("/giris");
    await op.getByLabel("E-posta").fill(email);
    await op.getByLabel("Parola").fill(pass2);
    await op.getByRole("button", { name: "Giriş yap" }).click();
    await op.getByLabel("Doğrulama kodu").fill(totp(secret));
    await op.getByRole("button", { name: "Doğrula ve giriş yap" }).click();
    await expect(op).toHaveURL(/\/panel/);

    resetTotpReplay(email);
    await page.goto("/giris");
    await page.getByLabel("E-posta").fill(email);
    await page.getByLabel("Parola").fill(pass2);
    await page.getByRole("button", { name: "Giriş yap" }).click();
    await page.getByLabel("Doğrulama kodu").fill(totp(secret));
    await page.getByRole("button", { name: "Doğrula ve giriş yap" }).click();
    await page.waitForURL(/\/panel/);
    await page.goto("/guvenlik");
    const rows = page.getByTestId("session-row");
    await expect(rows.filter({ hasText: "Bu cihaz" })).toHaveCount(1);
    await expect(rows.first()).toBeVisible();
    await page.getByRole("button", { name: "Diğer tüm oturumları kapat" }).click();
    await expectToast(page, /oturum kapatıldı/);
    expect((await op.request.get("/api/p/auth/me")).status()).toBe(401);
    await op.goto("/panel");
    await expect(op).toHaveURL(/\/giris/);
    await other.close();
    await expect(rows).toHaveCount(1);
  });

  test("işletme sahibi 2FA zorunluluğunu açıp kapatabilir", async ({ page }) => {
    resetTotpReplay(email);
    await page.goto("/giris");
    await page.getByLabel("E-posta").fill(email);
    await page.getByLabel("Parola").fill(pass2);
    await page.getByRole("button", { name: "Giriş yap" }).click();
    await page.getByLabel("Doğrulama kodu").fill(totp(secret));
    await page.getByRole("button", { name: "Doğrula ve giriş yap" }).click();
    await page.waitForURL(/\/panel/);
    await page.goto("/panel/ayarlar");
    await page.getByLabel("Sahip ve yöneticiler için 2FA zorunlu").check();
    await expectToast(page, "2FA zorunluluğu açıldı");
    await page.reload();
    await expect(page.getByLabel("Sahip ve yöneticiler için 2FA zorunlu")).toBeChecked();
    await page.getByLabel("Sahip ve yöneticiler için 2FA zorunlu").uncheck();
    await expectToast(page, "2FA zorunluluğu kapatıldı");
  });
});

test.describe("Oturum güvenliği", () => {
  test("çıkış yapınca çalınmış çerez/token da geçersiz olur", async ({ browser }) => {
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    await p.goto("/giris");
    await p.getByLabel("E-posta").fill("resepsiyon@proguzellik.local");
    await p.getByLabel("Parola").fill(process.env.E2E_PASSWORD ?? "E2eDemo12345");
    await p.getByRole("button", { name: "Giriş yap" }).click();
    await expect(p).toHaveURL(/\/panel/);
    const stolen = (await ctx.cookies()).find((c) => c.name === "pg_token")!;
    await p.request.post("/api/auth/logout");
    const thief = await browser.newContext();
    await thief.addCookies([stolen]);
    const tp = await thief.newPage();
    expect((await tp.request.get("/api/p/auth/me")).status()).toBe(401);
    await ctx.close();
    await thief.close();
  });
});

test.describe("SaaS paneli: günlük görev", () => {
  test.use({ storageState: authFile("platform") });
  test("görev elle tetiklenir, kaydı görünür; aynı gün ikinci kez atlanır", async ({ page }) => {
    await page.goto("/yonetim");
    await page.getByRole("button", { name: "Şimdi çalıştır" }).click();
    await expectToast(page, /Görev çalıştırıldı|Atlandı/);
    await page.getByRole("button", { name: "Şimdi çalıştır" }).click();
    await expectToast(page, "Atlandı: Bugün zaten çalıştı");
    await expect(page.getByRole("row").filter({ hasText: "SUCCESS" }).first()).toBeVisible();
  });
});
