import { expect, test as setup } from "@playwright/test";
import { PASSWORD } from "../env";
import { authFile, login, UserKey, USERS } from "./helpers";
import { totp } from "./totp";

for (const key of Object.keys(USERS) as UserKey[]) {
  setup(`oturum: ${key}`, async ({ page }) => {
    await login(page, USERS[key]);
    if (key === "platform") {
      // SaaS yöneticisi için 2FA zorunlu: panel güvenlik sayfasına yönlendirir; arayüzden etkinleştirilir.
      // Giriş sonrası /yonetim açılır; API 2FA kurulumu istediği için güvenlik sayfasına yönlendirilir.
      await page.waitForURL(/\/guvenlik\?zorunlu=1/);
      await expect(page.getByText(/iki adımlı doğrulama zorunlu/)).toBeVisible();
      await page.getByRole("button", { name: /2FA'yı etkinleştir/ }).click();
      const dlg = page.getByRole("dialog");
      await dlg.getByLabel("Parolanızı doğrulayın").fill(PASSWORD);
      await dlg.getByRole("button", { name: "Devam" }).click();
      const secret = (await dlg.getByTestId("mfa-secret").textContent())!.trim();
      await expect(dlg.getByRole("img", { name: "2FA QR kodu" })).toBeVisible();
      await dlg.getByLabel("Doğrulama kodu").fill(totp(secret));
      await dlg.getByRole("button", { name: "Etkinleştir" }).click();
      await expect(dlg.getByTestId("recovery-codes").locator("li")).toHaveCount(10);
      await dlg.getByRole("button", { name: "Kaydettim" }).click();
      const fs = await import("node:fs");
      fs.writeFileSync(".auth/platform-secret.txt", secret);
      await page.goto("/yonetim");
      await expect(page.getByText("MRR (aylık gelir)")).toBeVisible();
    }
    await page.context().storageState({ path: authFile(key) });
  });
}
