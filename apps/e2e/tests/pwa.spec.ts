import { execSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { E2E_PSQL } from "../env";

/**
 * PWA V1.0 tarayıcı testleri (mobil): bayraklar kapalıyken eski akış aynen; açıkken salon uygulaması,
 * kapsamlı service worker (HTML/API/kişisel veri önbelleğe alınmaz), e-posta koduyla giriş ve randevu.
 */
const SLUG = "isilti-guzellik";
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

test("müşteri portalı: e-posta koduyla giriş, randevu alma, Randevularım; oturum çerezi httpOnly ve salona özel", async ({ page, context }) => {
  setFlags(true);
  const email = `pwa.${Date.now()}@test.local`;
  await page.goto(`/r/${SLUG}/uygulama`);
  await page.getByRole("button", { name: /Kirpik Lifting/ }).click();
  const days = page.getByRole("listbox", { name: "Tarih" }).getByRole("option");
  let found = false;
  for (let i = 0; i < 10 && !found; i++) {
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
  await page.getByRole("button", { name: "Randevularıma git" }).click();
  await expect(page.getByText("Kirpik Lifting").first()).toBeVisible();
  // Çerez başka salona veya panele gitmez
  expect(cookie!.path).not.toBe("/");
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
