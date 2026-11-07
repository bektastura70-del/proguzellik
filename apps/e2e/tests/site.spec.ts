import { expect, test } from "@playwright/test";
import { login, USERS } from "./helpers";

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
  ["/gizlilik-politikasi", /Gizlilik Politikası/],
  ["/cerez-politikasi", /Çerez Politikası/],
  ["/kullanim-kosullari", /Kullanım Koşulları/],
  ["/faturalandirma-politikasi", /Faturalandırma ve Ödeme Belgeleri Politikası/],
  ["/hesap-kapatma-ve-veri-silme", /Hesap Kapatma, Veri Teslimi ve Veri Silme Politikası/],
  ["/sorumluluk-sinirlari", /Sorumluluk Sınırları ve Hizmet Güvenceleri/],
  ["/mesafeli-satis-sozlesmesi", /Mesafeli Satış Sözleşmesi/],
  ["/teslimat-ve-iade-sartlari", /Teslimat ve İade Şartları/],
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

  test("iyzico kriterleri: taslak mesafeli satış ve teslimat/iade sayfaları, footer'da ödeme logoları", async ({ page }) => {
    for (const path of ["/mesafeli-satis-sozlesmesi", "/teslimat-ve-iade-sartlari"]) {
      await page.goto(path);
      const main = page.locator("main");
      await expect(main, path).not.toContainText(/\[[A-ZÇĞİÖŞÜ][A-ZÇĞİÖŞÜa-zçğıöşü ]{3,}\]/);
      // Hukuk onayı gelene kadar taslak uyarısı görünür ve künyede yürürlük tarihi yerine taslak tarihi yer alır.
      await expect(main, path).toContainText("Bu metin bir şablondur");
      const imprint = page.getByTestId("legal-imprint");
      await expect(imprint).toContainText("BEKTAŞ TURA REKLAM MEDYA VE BİLGİ TEKNOLOJİLERİ LİMİTED ŞİRKETİ");
      await expect(imprint).toContainText(/Taslak Tarihi\s*07\.11\.2026/);
      await expect(imprint).not.toContainText("Yürürlük Tarihi");
      const logos = page.getByTestId("payment-logos");
      await expect(logos).toBeVisible();
      expect(await logos.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
    }
    await page.goto("/");
    const footer = page.locator("footer");
    await footer.getByRole("link", { name: "Mesafeli Satış Sözleşmesi" }).click();
    await expect(page).toHaveURL(/\/mesafeli-satis-sozlesmesi$/);
    await page.locator("main").getByRole("link", { name: "Teslimat ve İade Şartları" }).click();
    await expect(page).toHaveURL(/\/teslimat-ve-iade-sartlari$/);
    await page.goto("/hakkimizda");
    await expect(page.getByTestId("legal-imprint")).toContainText("BEKTAŞ TURA REKLAM MEDYA VE BİLGİ TEKNOLOJİLERİ LİMİTED ŞİRKETİ");
    await expect(page.getByTestId("legal-imprint")).not.toContainText("Yürürlük Tarihi");
  });

  test("hukuki metinlerde yer tutucu ve taslak notu yok; künye Şirket ayarları'ndan gelir", async ({ page }) => {
    const site = (await (await page.request.get("/api/p/public/site")).json()) as { company: { address: string | null } };
    for (const path of ["/kvkk", "/gizlilik-politikasi", "/cerez-politikasi", "/kullanim-kosullari", "/faturalandirma-politikasi", "/hesap-kapatma-ve-veri-silme", "/sorumluluk-sinirlari"]) {
      await page.goto(path);
      const main = page.locator("main");
      await expect(main, path).not.toContainText(/\[[A-ZÇĞİÖŞÜ][A-ZÇĞİÖŞÜa-zçğıöşü ]{3,}\]/);
      await expect(main, path).not.toContainText(/Yayın öncesi not|sözleşme taslağıdır|Bu metin bir şablondur/);
      const imprint = page.getByTestId("legal-imprint");
      await expect(imprint).toContainText("BEKTAŞ TURA REKLAM MEDYA VE BİLGİ TEKNOLOJİLERİ LİMİTED ŞİRKETİ");
      await expect(imprint).toContainText("info@proguzellik.com");
      await expect(imprint).toContainText(/Yürürlük Tarihi\s*04\.11\.2026/);
      await expect(imprint).toContainText(/Son Güncelleme Tarihi\s*04\.11\.2026/);
      await expect(imprint).toContainText(/Belge Sürümü\s*1\.0/);
      if (site.company.address) await expect(imprint).toContainText("Şirket Adresi");
    }
    await page.goto("/kvkk");
    await expect(page.getByRole("table").first()).toContainText("Anthropic");
    // Deneme başvurusu notu: kodda uygulanan saklama süreleriyle aynı (48 saat / 30 gün)
    await expect(page.getByTestId("legal-note")).toContainText("Ücretsiz deneme başvuruları");
    await expect(page.getByTestId("legal-note")).toContainText("48 saat");
    await expect(page.getByTestId("legal-note")).toContainText("30 gün");
    await page.goto("/kullanim-kosullari");
    await page.getByRole("link", { name: "Veri Saklama ve Hesap Kapatma Politikası" }).click();
    await expect(page).toHaveURL(/\/hesap-kapatma-ve-veri-silme$/);
    await page.goto("/gizlilik");
    await expect(page).toHaveURL(/\/gizlilik-politikasi$/);
    await expect(page.getByRole("heading", { name: "5. Üçüncü Taraf Hizmet Sağlayıcıları" })).toBeVisible();
    await expect(page.getByTestId("legal-note")).toContainText("Anthropic");
    await page.goto("/cerez-politikasi");
    await expect(page.getByRole("heading", { name: "3.1. Kesinlikle Gerekli Çerezler" })).toBeVisible();
    await expect(page.getByRole("link", { name: "info@proguzellik.com" }).first()).toHaveAttribute("href", "mailto:info@proguzellik.com");
    for (const name of ["pg_token", "pg_tenant"]) await expect(page.getByTestId("legal-note")).toContainText(name);
  });

  test("çerez envanteri: herkese açık sayfalar çerez, tarayıcı depolaması ve dış kaynak kullanmaz; girişte yalnız tablodaki iki çerez", async ({ page, context, baseURL }) => {
    const origin = new URL(baseURL!).host;
    const foreign: string[] = [];
    page.on("request", (r) => { const h = new URL(r.url()).host; if (h !== origin && !r.url().startsWith("data:")) foreign.push(r.url()); });
    for (const path of ["/", "/fiyatlar", "/ucretsiz-deneme", "/giris", "/kvkk", "/gizlilik-politikasi", "/cerez-politikasi"]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
    }
    expect(await context.cookies()).toEqual([]);
    expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
    expect(foreign).toEqual([]);
    await page.goto("/ucretsiz-deneme");
    const links = page.getByTestId("policy-links");
    for (const href of ["/kvkk", "/gizlilik-politikasi", "/cerez-politikasi", "/kullanim-kosullari"]) await expect(links.locator(`a[href="${href}"]`)).toBeVisible();
    await login(page, USERS.owner);
    const names = (await context.cookies()).map((c) => c.name).sort();
    expect(names).toEqual(["pg_tenant", "pg_token"]);
    expect((await context.cookies()).find((c) => c.name === "pg_token")?.httpOnly).toBe(true);
    expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
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
