import { execSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { E2E_PSQL } from "../env";

/**
 * PWA V1.0 tarayıcı testleri (mobil): bayraklar kapalıyken eski akış aynen; açıkken salon uygulaması,
 * kapsamlı service worker (HTML/API/kişisel veri önbelleğe alınmaz), e-posta koduyla giriş ve randevu.
 */
const SLUG = "isilti-guzellik";
const ANDROID_UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";
const iphoneUa = (v = "17_5") => `Mozilla/5.0 (iPhone; CPU iPhone OS ${v} like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1`;
const BANNER = /uygulamasını telefonunuza ekleyin/;
const sql = (q: string) => execSync(E2E_PSQL, { input: q, encoding: "utf8" }).trim();
const tenantId = () => sql(`SELECT id FROM "Tenant" WHERE slug='${SLUG}'`);
const setFlags = (on: boolean) =>
  sql(`INSERT INTO "TenantPwaSettings" ("tenantId","customerPwaEnabled","customerBookingEnabled","customerSessionTrackingEnabled","businessPwaEnabled","updatedAt")
       VALUES ('${tenantId()}', ${on}, ${on}, ${on}, ${on}, now())
       ON CONFLICT ("tenantId") DO UPDATE SET "customerPwaEnabled"=${on}, "customerBookingEnabled"=${on}, "customerSessionTrackingEnabled"=${on}, "businessPwaEnabled"=${on}`);

test.describe.configure({ mode: "serial" });
test.afterAll(() => setFlags(false));

test("bayraklar kapalıyken: eski online randevu sayfası aynen, uygulama adresleri yok", async ({ page, request }) => {
  setFlags(false);
  await page.goto(`/r/${SLUG}`);
  await expect(page).toHaveURL(new RegExp(`/r/${SLUG}$`));
  await expect(page.getByRole("heading", { name: "Işıltı Güzellik Stüdyosu" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Kirpik Lifting/ })).toBeVisible();
  expect(await page.locator('link[rel="manifest"][href*="/r/"]').count()).toBe(0);
  expect((await request.get(`/r/${SLUG}/manifest.webmanifest`)).status()).toBe(404);
  expect((await request.get(`/r/${SLUG}/uygulama`)).status()).toBe(404);
  // Kurulum önerisi yok
  expect(await page.getByText(/uygulamasını telefonunuza ekleyin/).count()).toBe(0);
  // Portal uçları kapalı
  expect((await request.post(`/r/${SLUG}/api/portal/otp`, { data: { email: "x@test.local" }, headers: { Origin: "http://localhost:3200" } })).status()).toBe(404);
});

test("salon uygulaması: manifest kapsamı, service worker yalnızca çevrimdışı ekranı ve simgeyi önbelleğe alır", async ({ page, request }) => {
  setFlags(true);
  await page.goto(`/r/${SLUG}`);
  await expect(page).toHaveURL(new RegExp(`/r/${SLUG}/uygulama$`));
  const manifest = await (await request.get(`/r/${SLUG}/manifest.webmanifest`)).json();
  expect(manifest).toMatchObject({ id: `/r/${SLUG}/uygulama`, start_url: `/r/${SLUG}/uygulama`, scope: `/r/${SLUG}/`, display: "standalone" });
  expect(manifest.icons.map((i: { sizes: string }) => i.sizes)).toEqual(["192x192", "512x512", "512x512"]);
  expect((await request.get(`/r/${SLUG}/simge/512`)).headers()["content-type"]).toBe("image/png");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  // API ve sayfa istekleri yapıldıktan sonra da önbellekte kişisel veri olmamalı
  await page.evaluate(() => fetch(`/r/isilti-guzellik/api/app`).then((r) => r.text()));
  const info = await page.evaluate(async () => {
    const regs = await navigator.serviceWorker.getRegistrations();
    const caches_: Record<string, string[]> = {};
    for (const k of await caches.keys()) caches_[k] = (await (await caches.open(k)).keys()).map((r) => new URL(r.url).pathname);
    return { scopes: regs.map((r) => new URL(r.scope).pathname), controller: navigator.serviceWorker.controller?.scriptURL ?? null, caches: caches_ };
  });
  expect(info.scopes).toEqual([`/r/${SLUG}/`]);
  expect(info.controller).toContain(`/r/${SLUG}/sw.js`);
  expect(info.caches).toEqual({ [`pg-salon-${SLUG}-v1`]: [`/r/${SLUG}/cevrimdisi`, `/r/${SLUG}/simge/192`] });
  // Çevrimdışı: sayfa yerine salonun çevrimdışı ekranı
  await page.context().setOffline(true);
  await page.goto(`/r/${SLUG}/uygulama`).catch(() => undefined);
  await expect(page.getByText("İnternet bağlantısı yok")).toBeVisible();
  await page.context().setOffline(false);
});

test.describe("Android telefonda", () => {
  test.use({ userAgent: ANDROID_UA });
  test("müşteri portalı: e-posta koduyla giriş, randevu alma, Randevularım; oturum çerezi httpOnly ve salona özel", async ({ page, context }) => {
  setFlags(true);
  const email = `pwa.${Date.now()}@test.local`;
  await page.goto(`/r/${SLUG}/uygulama`);
  await page.getByRole("button", { name: /Kirpik Lifting/ }).click();
  const days = page.getByRole("listbox", { name: "Tarih" }).getByRole("option");
  let found = false;
  // Bugün değil yarından başla: bugünün son boş saati "çok yakın" sayılabilir (saate bağlı test hatası)
  for (let i = 1; i < 11 && !found; i++) {
    await days.nth(i).click();
    await page.waitForTimeout(400);
    found = (await page.getByRole("button", { name: /^\d{2}:\d{2}$/ }).count()) > 0;
  }
  expect(found).toBe(true);
  await page.getByRole("button", { name: /^\d{2}:\d{2}$/ }).first().click();
  // Randevu için giriş istenir
  await page.getByLabel("E-posta adresiniz").fill(email);
  await page.getByRole("button", { name: "Kod gönder" }).click();
  await expect(page.getByLabel("6 haneli kod")).toBeVisible();
  const body = sql(`SELECT body FROM "OutboundEmail" WHERE "to"='${email}' ORDER BY "createdAt" DESC LIMIT 1`);
  const code = /\b(\d{6})\b/.exec(body)?.[1];
  expect(code).toBeTruthy();
  await page.getByLabel("6 haneli kod").fill(code!);
  await page.getByRole("button", { name: "Doğrula" }).click();
  await expect(page.getByRole("heading", { name: "3. Bilgileriniz" })).toBeVisible();
  const cookie = (await context.cookies()).find((c) => c.name === "pg_cs");
  expect(cookie).toMatchObject({ httpOnly: true, path: `/r/${SLUG}`, sameSite: "Lax" });
  expect(await page.evaluate(() => document.cookie)).not.toContain("pg_cs");
  await page.getByLabel("Adınız", { exact: true }).fill("Pwa");
  await page.getByLabel("Soyadınız").fill("Deneme");
  await page.getByLabel("Cep telefonu").fill(`0555${String(Date.now()).slice(-7)}`);
  await page.getByRole("checkbox").first().check();
  await page.getByRole("button", { name: "Randevuyu onayla" }).click();
  await expect(page.getByRole("heading", { name: "Randevunuz alındı" })).toBeVisible();
  // Randevu sonrası "uygulamayı ekle" önerisi
  await expect(page.getByTestId("after-booking-install")).toContainText("hatırlatmaları kaçırmayın");
  await page.getByRole("button", { name: "Randevularıma git" }).click();
  await expect(page.getByText("Kirpik Lifting").first()).toBeVisible();
  // Çerez başka salona veya panele gitmez
  expect(cookie!.path).not.toBe("/");
});
});

test("uygulama kapatılınca kurulu service worker kendini kaldırır ve önbelleği siler (geri alma)", async ({ page }) => {
  setFlags(true);
  await page.goto(`/r/${SLUG}/uygulama`);
  await page.evaluate(() => navigator.serviceWorker.ready);
  setFlags(false);
  await page.evaluate(async () => (await navigator.serviceWorker.getRegistration("/r/isilti-guzellik/"))?.update());
  await expect
    .poll(async () => page.evaluate(async () => ({ regs: (await navigator.serviceWorker.getRegistrations()).length, caches: (await caches.keys()).length })), { timeout: 10_000 })
    .toEqual({ regs: 0, caches: 0 });
  await page.goto(`/r/${SLUG}`);
  await expect(page.getByRole("button", { name: /Kirpik Lifting/ })).toBeVisible();
});

test.describe("ana ekrana ekleme", () => {
  test.beforeEach(() => setFlags(true));

  test("Android/Chrome: tek dokunuşluk 'Uygulamayı yükle' kurulum penceresini açar, kabul edilince öneri kaybolur", async ({ page }) => {
    await page.goto(`/r/${SLUG}/uygulama`);
    await expect(page.getByRole("button", { name: /Kirpik Lifting/ })).toBeVisible();
    // Masaüstü tarayıcı kimliği: kurulum penceresi yokken öneri gösterilmez
    expect(await page.getByText(BANNER).count()).toBe(0);
    // Chrome'un kurulum olayını taklit et (gerçek pencereyi yalnız gerçek cihaz açar)
    await page.evaluate(() => {
      const e = new Event("beforeinstallprompt") as Event & Record<string, unknown>;
      e.prompt = async () => { (window as unknown as Record<string, boolean>).__prompted = true; };
      e.userChoice = Promise.resolve({ outcome: "accepted" });
      window.dispatchEvent(e);
    });
    await expect(page.getByText(BANNER)).toBeVisible();
    await page.getByRole("button", { name: "Uygulamayı yükle" }).click();
    expect(await page.evaluate(() => (window as unknown as Record<string, boolean>).__prompted)).toBe(true);
    await expect(page.getByText(BANNER)).toHaveCount(0);
  });

  test.describe("iPhone Safari", () => {
    test.use({ userAgent: iphoneUa() });
    test("resimli adımlar ve iOS 16.4 bildirimi notu; kapatılınca tekrar görünmez", async ({ page }) => {
      await page.goto(`/r/${SLUG}/uygulama`);
      await expect(page.getByText(BANNER)).toBeVisible();
      await page.getByRole("button", { name: "Nasıl eklenir?" }).click();
      const steps = page.getByRole("list", { name: "iPhone'da ana ekrana ekleme adımları" });
      await expect(steps.getByRole("listitem")).toHaveCount(3);
      await expect(steps).toContainText("Ana Ekrana Ekle");
      await expect(page.getByText("iOS 16.4 veya üzeri")).toBeVisible();
      await expect(page.getByText(/sürümü bildirimleri desteklemiyor/)).toHaveCount(0);
      await page.getByRole("button", { name: "Kapat" }).click();
      await expect(page.getByText(BANNER)).toHaveCount(0);
      await page.reload();
      await expect(page.getByRole("button", { name: /Kirpik Lifting/ })).toBeVisible();
      expect(await page.getByText(BANNER).count()).toBe(0);
      // Hesabım'daki rehber kapatmadan etkilenmez
      await page.getByRole("button", { name: "Hesabım" }).click();
      await expect(page.getByRole("heading", { name: /uygulaması$/ })).toBeVisible();
    });
  });

  test.describe("eski iPhone (iOS 16.1)", () => {
    test.use({ userAgent: iphoneUa("16_1") });
    test("bildirimlerin desteklenmediği söylenir", async ({ page }) => {
      await page.goto(`/r/${SLUG}/uygulama`);
      await page.getByRole("button", { name: "Nasıl eklenir?" }).click();
      await expect(page.getByText(/sürümü bildirimleri desteklemiyor/)).toBeVisible();
    });
  });

  test.describe("Instagram uygulama içi tarayıcı", () => {
    test.use({ userAgent: `${iphoneUa()} Instagram 350.0.0.0` });
    test("ana ekrana eklenemeyeceği, Safari/Chrome'da açılması söylenir", async ({ page }) => {
      await page.goto(`/r/${SLUG}/uygulama`);
      await expect(page.getByText(BANNER)).toBeVisible();
      await expect(page.getByText(/Tarayıcıda aç/)).toBeVisible();
      expect(await page.getByRole("button", { name: "Nasıl eklenir?" }).count()).toBe(0);
    });
  });

  test.describe("uygulama zaten yüklü", () => {
    test.use({ userAgent: ANDROID_UA });
    test("ana ekrandan açılınca hiçbir kurulum önerisi gösterilmez", async ({ page }) => {
      await page.addInitScript(() => {
        const orig = window.matchMedia.bind(window);
        window.matchMedia = (q: string) => (q.includes("display-mode: standalone") ? ({ ...orig(q), matches: true, media: q, addEventListener() {}, removeEventListener() {} } as MediaQueryList) : orig(q));
      });
      await page.goto(`/r/${SLUG}/uygulama`);
      await expect(page.getByRole("button", { name: /Kirpik Lifting/ })).toBeVisible();
      await page.waitForTimeout(300);
      expect(await page.getByText(BANNER).count()).toBe(0);
      await page.getByRole("button", { name: "Hesabım" }).click();
      await expect(page.getByText("Uygulama bu cihazda yüklü.")).toBeVisible();
    });
  });
});
