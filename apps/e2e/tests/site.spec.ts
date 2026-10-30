import { expect, test } from "@playwright/test";

const PAGES = [
  ["/", /tek panelde/],
  ["/ozellikler", /ihtiyacınız olanlar/],
  ["/ozellikler/randevu-musteri", /Randevu ve müşteri/],
  ["/ozellikler/personel-prim", /Personel, yetki ve prim/],
  ["/ozellikler/stok-finans", /Stok, kasa ve paketler/],
  ["/ozellikler/raporlar", /Raporlar ve işletme asistanı/],
  ["/fiyatlar", /paketi seçin/],
  ["/sss", /Sık sorulan sorular/],
  ["/iletisim", /Bize ulaşın/],
  ["/hakkimizda", /sade bir yönetim yazılımı/],
  ["/kvkk", /KVKK Aydınlatma Metni/],
  ["/gizlilik", /Gizlilik/],
  ["/cerez-politikasi", /Çerez/],
  ["/kullanim-kosullari", /Kullanım Koşulları/],
] as const;

test.describe("Tanıtım sitesi", () => {
  for (const [path, h1] of PAGES) {
    test(`${path}: başlık, Giriş Yap ve 14 Gün Ücretsiz Dene görünür`, async ({ page }) => {
      const res = await page.goto(path);
      expect(res?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(h1);
      const header = page.getByRole("banner");
      await expect(header.getByRole("link", { name: "14 Gün Ücretsiz Dene" })).toBeVisible();
      expect(await page.title()).toMatch(/ProGüzellik/);
      expect(await page.locator('meta[name="description"]').getAttribute("content")).toBeTruthy();
      // Doğrulanmamış iddialar yok
      await expect(page.getByText(/En çok tercih edilen|müşterimiz|memnun müşteri|\+\d+ salon/i)).toHaveCount(0);
    });
  }

  test("fiyatlar veritabanındaki paketlerden gelir; onaylı fiyatı olmayan pakette hiçbir tutar gösterilmez", async ({ page }) => {
    const plans = (await (await page.request.get("/api/p/plans")).json()) as { code: string; name: string; maxStaff: number; monthlyPrice: string | null; vatRate: string | null }[];
    const anyPrice = plans.some((p) => p.monthlyPrice !== null);
    for (const path of ["/fiyatlar", "/"]) {
      await page.goto(path);
      if (anyPrice) {
        await expect(page.getByText("Fiyatlar Yakında Açıklanacak")).toHaveCount(0);
      } else {
        await expect(page.getByRole("heading", { name: "Fiyatlar Yakında Açıklanacak" })).toBeVisible();
        await expect(page.locator("main")).not.toContainText(/₺|\bTL\b|\/ ay/);
      }
      for (const p of plans) {
        const card = page.locator(`article[data-plan="${p.code}"]`);
        if (p.monthlyPrice === null) {
          await expect(card).toContainText("Fiyat yakında");
          await expect(card).not.toContainText("₺");
        } else {
          await expect(card).toContainText(`%${Number(p.vatRate).toLocaleString("tr-TR")} KDV eklenir`);
        }
      }
      // Eski demo tutarları hiçbir koşulda görünmez
      await expect(page.locator("main")).not.toContainText(/₺499|₺999|₺1\.799/);
    }
    await page.goto("/fiyatlar");
    for (const p of plans) {
      const card = page.getByRole("article").filter({ has: page.getByRole("heading", { name: p.name, exact: true }) });
      await expect(card).toContainText(`En fazla ${p.maxStaff} aktif personel`);
    }
    await expect(page.getByRole("article")).toHaveCount(plans.length);
  });

  test("CTA'lar doğru sayfalara gider; mobil menü çalışır", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto("/");
    await page.getByRole("button", { name: "Menüyü aç" }).click();
    await page.getByRole("navigation", { name: "Mobil menü" }).getByRole("link", { name: "Fiyatlar" }).click();
    await expect(page).toHaveURL(/\/fiyatlar$/);
    await page.getByRole("banner").getByRole("link", { name: "14 Gün Ücretsiz Dene" }).click();
    await expect(page).toHaveURL(/\/ucretsiz-deneme$/);
    await page.goto("/");
    await page.getByRole("main").getByRole("link", { name: "Giriş Yap" }).first().click();
    await expect(page).toHaveURL(/\/giris$/);
  });

  test("robots ve site haritası: panel ve yönetim dizine eklenmez", async ({ page }) => {
    const robots = await (await page.request.get("/robots.txt")).text();
    expect(robots).toMatch(/Disallow: \/panel/);
    expect(robots).toMatch(/Disallow: \/platform/);
    const map = await (await page.request.get("/sitemap.xml")).text();
    expect(map).toContain("/ozellikler/stok-finans");
    expect(map).not.toContain("/panel");
  });
});
