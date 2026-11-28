import { Browser, expect, test } from "@playwright/test";
import { authFile } from "./helpers";

/**
 * Telefona anlık bildirim (işletme paneli), salon uygulaması pilotu KAPALI işletmede (gerçek salon, 28.11):
 * Bildirim merkezi'nde kart her zaman görünür, iPhone'da durum/tanı ve kurulum adımları çıkar,
 * ana ekran uygulamasında bildirim açık değilse panelde hatırlatma görünür.
 */
test.use({ storageState: authFile("owner") });

const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";

async function iphone(browser: Browser, standalone: boolean) {
  const ctx = await browser.newContext({ storageState: authFile("owner"), userAgent: IPHONE_UA, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "tr-TR" });
  if (standalone) await ctx.addInitScript(() => Object.defineProperty(Navigator.prototype, "standalone", { get: () => true }));
  return ctx;
}

test("iPhone Safari'de (ana ekrana eklenmemiş): kart ana ekrana ekleme adımlarını gösterir", async ({ browser }) => {
  const ctx = await iphone(browser, false);
  const page = await ctx.newPage();
  await page.goto("/panel/bildirim-merkezi");
  const card = page.getByTestId("telefon-bildirimi");
  await expect(card).toBeVisible();
  await expect(card).toContainText("ana ekrana eklenen uygulamadan");
  await expect(card.getByTestId("ios-push-adimlari")).toBeVisible();
  await expect(card.getByTestId("push-tani")).toContainText("iPhone, Safari");
  await expect(page.getByTestId("bildirim-kanallari")).toContainText("her telefonda ayrı ayrı açılır");
  await ctx.close();
});

test("iPhone ana ekran uygulamasında: 'Bildirimleri aç' düğmesi, tanı ve paneldeki hatırlatma", async ({ browser }) => {
  const ctx = await iphone(browser, true);
  const page = await ctx.newPage();
  await page.goto("/panel");
  const nudge = page.getByTestId("push-hatirlatma");
  await expect(nudge).toBeVisible();
  await nudge.getByRole("link", { name: "Bildirimleri aç" }).click();
  await expect(page).toHaveURL(/\/panel\/bildirim-merkezi/);
  const card = page.getByTestId("telefon-bildirimi");
  await expect(card.getByRole("button", { name: "Bildirimleri aç" })).toBeVisible();
  await expect(card.getByTestId("push-tani")).toContainText("iPhone, ana ekran uygulaması");
  await expect(card.getByTestId("push-tani")).toContainText("henüz sorulmadı");
  await expect(page.getByTestId("push-hatirlatma")).toHaveCount(0);
  // "Daha sonra" ile 7 gün gizlenir
  await page.goto("/panel");
  await page.getByTestId("push-hatirlatma").getByRole("button", { name: "Daha sonra" }).click();
  await expect(page.getByTestId("push-hatirlatma")).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByTestId("push-hatirlatma")).toHaveCount(0);
  await ctx.close();
});

test("masaüstünde hatırlatma çıkmaz, kart görünür", async ({ page }) => {
  await page.goto("/panel");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByTestId("push-hatirlatma")).toHaveCount(0);
  await page.goto("/panel/bildirim-merkezi");
  await expect(page.getByTestId("telefon-bildirimi")).toBeVisible();
});

