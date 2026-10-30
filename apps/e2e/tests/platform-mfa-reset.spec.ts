import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { PASSWORD } from "../env";
import { authFile, expectToast, submitTrialForm, uniq, USERS } from "./helpers";
import { lastEmail, resetTotpReplay, sql, totp } from "./totp";

test("SaaS sahibi kullanıcının 2FA'sını parola + kendi koduyla sıfırlar; kullanıcı oturumu kapanır", async ({ page, browser }) => {
  const email = `${uniq("mfa-sifir").replace(" ", "-")}@proguzellik.local`;
  const name = "2FA Sıfırlama Testi";
  // Kullanıcı: deneme kaydı + 2FA etkinleştirme
  await submitTrialForm(page, { business: uniq("2FA Salon"), name, email, password: PASSWORD });
  const link = /(\/ucretsiz-deneme\/dogrula\?token=[A-Za-z0-9_-]+)/.exec(lastEmail(email, "Ücretsiz denemenizi başlatmak için e-postanızı doğrulayın"))![1];
  await page.goto(link);
  await page.getByRole("button", { name: "E-postamı doğrula ve denemeyi başlat" }).click();
  await expect(page).toHaveURL(/\/panel/);
  await page.goto("/guvenlik");
  await page.getByRole("button", { name: /2FA'yı etkinleştir/ }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel("Parolanızı doğrulayın").fill(PASSWORD);
  await dlg.getByRole("button", { name: "Devam" }).click();
  const secret = (await dlg.getByTestId("mfa-secret").textContent())!.trim();
  await dlg.getByLabel("Doğrulama kodu").fill(totp(secret));
  await dlg.getByRole("button", { name: "Etkinleştir" }).click();
  await dlg.getByRole("button", { name: "Kaydettim" }).click();
  expect((await page.request.get("/api/p/auth/me")).status()).toBe(200);

  // SaaS sahibi
  const ctx = await browser.newContext({ storageState: authFile("platform") });
  const admin = await ctx.newPage();
  await admin.goto("/platform");
  await admin.getByRole("tab", { name: "Kullanıcılar" }).click();
  await admin.getByLabel("Kullanıcı ara").fill(email);
  const row = admin.getByRole("row").filter({ hasText: email });
  await expect(row).toContainText("2FA");
  await row.getByRole("button", { name: "Yönet" }).click();
  const udlg = admin.getByRole("dialog");
  await udlg.getByRole("button", { name: "2FA'yı sıfırla" }).click();
  await udlg.getByLabel("Sıfırlama gerekçesi").fill("Kullanıcı telefonunu kaybetti, kimliği doğrulandı");
  await udlg.getByLabel("Parolanız").fill(PASSWORD);
  // Yanlış kod reddedilir, hiçbir şey değişmez
  await udlg.getByLabel("2FA kodunuz").fill("000000");
  await udlg.getByRole("button", { name: "2FA'yı sıfırla" }).click();
  await expect(udlg.getByText("Parola veya doğrulama kodu hatalı")).toBeVisible();
  await expect(admin).toHaveURL(/\/platform/);
  expect(sql(`SELECT ("mfaEnabledAt" IS NOT NULL)::text FROM "User" WHERE email='${email}'`)).toBe("true");

  resetTotpReplay(USERS.platform);
  await udlg.getByLabel("2FA kodunuz").fill(totp(readFileSync(".auth/platform-secret.txt", "utf8").trim()));
  await udlg.getByRole("button", { name: "2FA'yı sıfırla" }).click();
  await expectToast(admin, "2FA sıfırlandı, oturumlar kapatıldı");
  expect(sql(`SELECT ("mfaEnabledAt" IS NULL)::text FROM "User" WHERE email='${email}'`)).toBe("true");
  expect((await page.request.get("/api/p/auth/me")).status()).toBe(401);
  expect(sql(`SELECT count(*) FROM "AuditLog" WHERE action='platform.user_mfa_reset' AND "createdAt" > now() - interval '5 minutes'`)).not.toBe("0");
  await ctx.close();
});
