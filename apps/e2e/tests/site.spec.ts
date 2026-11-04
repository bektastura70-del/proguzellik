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
  ["/faturalandirma-politikasi", /Faturalandırma ve Ödeme Belgeleri Politikası/],
  ["/hesap-kapatma-ve-veri-silme", /Hesap Kapatma, Veri Teslimi ve Veri Silme Politikası/],
  ["/sorumluluk-sinirlari", /Sorumluluk Sınırları ve Hizmet Güvenceleri/],
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
    await page.getByRole("banner").getByRole("link", { name: "Ücretsiz Dene", exact: true }).click();
    await expect(page).toHaveURL(/\/ucretsiz-deneme$/);
    await page.goto("/");
    await page.getByRole("main").getByRole("link", { name: "Giriş Yap" }).first().click();
    await expect(page).toHaveURL(/\/giris$/);
  });

  test("telefon genişliklerinde sayfa yana taşmaz; menü düğmesi ekranın içinde kalır", async ({ page }) => {
    for (const width of [320, 360, 390, 414]) {
      await page.setViewportSize({ width, height: 800 });
      for (const path of ["/", "/fiyatlar", "/ozellikler", "/sss", "/iletisim", "/kvkk", "/ucretsiz-deneme"]) {
        await page.goto(path);
        const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
        expect(m.sw, `${path} @ ${width}px`).toBeLessThanOrEqual(m.cw);
        const menu = page.getByRole("button", { name: "Menüyü aç" });
        if (await menu.count()) {
          const box = (await menu.boundingBox())!;
          expect(box.x + box.width, `${path} menü @ ${width}px`).toBeLessThanOrEqual(width);
        }
      }
    }
  });

  test("hukuki metinlerde yer tutucu ve taslak notu yok; künye Şirket ayarları'ndan gelir", async ({ page }) => {
    const site = (await (await page.request.get("/api/p/public/site")).json()) as { company: { address: string | null } };
    for (const path of ["/kvkk", "/kullanim-kosullari", "/faturalandirma-politikasi", "/hesap-kapatma-ve-veri-silme", "/sorumluluk-sinirlari"]) {
      await page.goto(path);
      const main = page.locator("main");
      await expect(main, path).not.toContainText(/\[[A-ZÇĞİÖŞÜ][A-ZÇĞİÖŞÜa-zçğıöşü ]{3,}\]/);
      await expect(main, path).not.toContainText(/Yayın öncesi not|sözleşme taslağıdır|Bu metin bir şablondur/);
      const imprint = page.getByTestId("legal-imprint");
      await expect(imprint).toContainText("BEKTAŞ TURA REKLAM MEDYA VE BİLGİ TEKNOLOJİLERİ LİMİTED ŞİRKETİ");
      await expect(imprint).toContainText("info@proguzellik.com");
      if (site.company.address) await expect(imprint).toContainText("Şirket Adresi");
    }
    await page.goto("/kvkk");
    await expect(page.getByRole("table")).toContainText("Anthropic");
    await page.goto("/kullanim-kosullari");
    await page.getByRole("link", { name: "Veri Saklama ve Hesap Kapatma Politikası" }).click();
    await expect(page).toHaveURL(/\/hesap-kapatma-ve-veri-silme$/);
    await page.goto("/gizlilik");
    await expect(page.locator("main")).not.toContainText("Yapay zekâ asistanına müşteri kimlik bilgisi gönderilmez");
  });

  test("robots ve site haritası: panel ve yönetim dizine eklenmez", async ({ page }) => {
    const robots = await (await page.request.get("/robots.txt")).text();
    expect(robots).toMatch(/Disallow: \/panel/);
    expect(robots).toMatch(/Disallow: \/platform/);
    const map = await (await page.request.get("/sitemap.xml")).text();
    expect(map).toContain("/ozellikler/stok-finans");
    expect(map).not.toContain("/panel");
    // Sağlık uçları dışarıdan (web vekili üzerinden) okunamaz
    expect((await page.request.get("/api/p/health/ready")).status()).toBe(404);
    expect((await page.request.get("/api/p/health")).status()).toBe(404);
  });
});
