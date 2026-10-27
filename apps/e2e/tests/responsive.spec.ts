import { expect, test } from "@playwright/test";
import { authFile, expectNoHorizontalOverflow } from "./helpers";

const PANEL = ["/panel", "/panel/takvim", "/panel/takvim?gorunum=hafta", "/panel/takvim?gorunum=ay", "/panel/musteriler", "/panel/hizmetler", "/panel/personel", "/panel/paketler", "/panel/kasa", "/panel/stok", "/panel/raporlar", "/panel/bildirimler", "/panel/asistan", "/panel/abonelik", "/panel/ayarlar"];

test.describe("Ekran düzeni (taşma yok, menü çalışır)", () => {
  test.use({ storageState: authFile("owner") });

  for (const path of PANEL) {
    test(`panel ${path}`, async ({ page }, info) => {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      await expect(page.locator("main h1").first()).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await info.attach(`${info.project.name}${path.replace(/[/?=]/g, "_")}`, { body: await page.screenshot({ fullPage: false }), contentType: "image/png" });
    });
  }

  test("mobil/tablet menüsü açılır ve gezinme çalışır", async ({ page }, info) => {
    test.skip(info.project.name === "desktop", "Masaüstünde yan menü sabittir");
    await page.goto("/panel");
    await page.getByRole("button", { name: "Menüyü aç" }).click();
    await page.getByRole("link", { name: "Müşteriler" }).click();
    await expect(page).toHaveURL(/musteriler/);
    await expect(page.getByRole("button", { name: "Menüyü kapat" })).toHaveCount(0);
  });

  test("diyaloglar ekrana sığar", async ({ page }) => {
    await page.goto("/panel/takvim");
    await page.getByRole("button", { name: "Randevu", exact: true }).click();
    const box = await page.getByRole("dialog").boundingBox();
    const vw = page.viewportSize()!.width;
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(vw + 1);
  });
});

test.describe("Herkese açık sayfalar", () => {
  for (const path of ["/", "/giris", "/kayit", "/kvkk", "/r/isilti-guzellik"]) {
    test(`sayfa ${path}`, async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      await expectNoHorizontalOverflow(page);
    });
  }
});
