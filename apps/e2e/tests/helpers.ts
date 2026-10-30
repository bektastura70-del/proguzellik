import { expect, Page } from "@playwright/test";
import { PASSWORD } from "../env";

export const USERS = {
  owner: "demo@proguzellik.local",
  reception: "resepsiyon@proguzellik.local",
  staff: "elif@proguzellik.local",
  platform: "owner@proguzellik.local",
  other: "kuafor@proguzellik.local",
} as const;
export type UserKey = keyof typeof USERS;
export const authFile = (u: UserKey) => `.auth/${u}.json`;

export async function login(page: Page, email: string, password = PASSWORD) {
  await page.goto("/giris");
  await page.getByLabel("E-posta").fill(email);
  await page.getByLabel("Parola").fill(password);
  await page.getByRole("button", { name: "Giriş yap" }).click();
  await page.waitForURL(/\/(panel|platform)/);
}

/** Toast mesajını doğrular (sahte başarı değil: ardından veri ayrıca kontrol edilir). */
export async function expectToast(page: Page, text: string | RegExp) {
  await expect(page.getByRole("status").or(page.locator("[aria-live=polite]")).getByText(text).first()).toBeVisible();
}

/** Sayfada yatay taşma olmadığını doğrular. */
export async function expectNoHorizontalOverflow(page: Page) {
  // Veriler yüklenip tablo/grafikler çizilene kadar bekle.
  await expect(page.getByLabel("Yükleniyor")).toHaveCount(0, { timeout: 10_000 });
  await page.waitForTimeout(300);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "yatay taşma (px)").toBeLessThanOrEqual(1);
}

/** API'ye tarayıcı oturumuyla doğrudan istek (kalıcılık kontrolleri için). */
export async function apiGet<T>(page: Page, path: string): Promise<T> {
  const res = await page.request.get(`/api/p${path}`);
  expect(res.status(), `${path} durum kodu`).toBe(200);
  return res.json() as Promise<T>;
}

export const uniq = (p: string) => `${p} ${Date.now().toString(36).slice(-5)}`;

/** Ücretsiz deneme formunu doldurup gönderir; "E-postanızı kontrol edin" ekranını bekler. */
export async function submitTrialForm(page: Page, o: { business: string; name: string; email: string; password: string }) {
  await page.goto("/ucretsiz-deneme");
  await page.getByLabel("İşletme adı").fill(o.business);
  await page.getByLabel("Yetkili adı soyadı").fill(o.name);
  await page.getByLabel("Telefon").fill(`05${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`);
  await page.getByLabel("E-posta").fill(o.email);
  await page.getByLabel("Parola", { exact: true }).fill(o.password);
  await page.getByLabel("Parola (tekrar)").fill(o.password);
  await page.getByLabel(/KVKK Aydınlatma Metni/).check();
  await page.getByLabel(/Kullanım Koşulları/).check();
  await page.getByRole("button", { name: "Ücretsiz denemeyi başlat" }).click();
  await expect(page.getByRole("heading", { name: "E-postanızı kontrol edin" })).toBeVisible();
}
