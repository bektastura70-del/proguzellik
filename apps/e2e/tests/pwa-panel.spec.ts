import { execSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { E2E_PSQL } from "../env";
import { authFile } from "./helpers";

/** İşletme panelinde salonun QR kodu ve kısa bağlantısı (yalnız salon uygulaması açıkken). */
const SLUG = "isilti-guzellik";
const sql = (q: string) => execSync(E2E_PSQL, { input: q, encoding: "utf8" }).trim();
const setPwa = (on: boolean) =>
  sql(`INSERT INTO "TenantPwaSettings" ("tenantId","customerPwaEnabled","customerBookingEnabled","updatedAt")
       SELECT id, ${on}, ${on}, now() FROM "Tenant" WHERE slug='${SLUG}'
       ON CONFLICT ("tenantId") DO UPDATE SET "customerPwaEnabled"=${on}, "customerBookingEnabled"=${on}`);

test.describe.configure({ mode: "serial" });
test.use({ storageState: authFile("owner") });
test.afterAll(() => setPwa(false));

test("uygulama kapalıyken QR kartı yok", async ({ page }) => {
  setPwa(false);
  await page.goto("/panel/uygulama");
  await expect(page.getByRole("heading", { name: "Salon uygulaması" })).toBeVisible();
  expect(await page.getByText("QR kod ve bağlantı").count()).toBe(0);
});

test("uygulama açıkken QR kod, kısa bağlantı, PNG/SVG indirme, afiş ve WhatsApp paylaşımı", async ({ page, context }) => {
  setPwa(true);
  await page.goto("/panel/uygulama");
  await expect(page.getByText("QR kod ve bağlantı")).toBeVisible();
  await expect(page.getByTestId("salon-qr")).toHaveAttribute("src", /^data:image\/png;base64,/);
  await expect(page.getByTestId("salon-link")).toHaveText(`localhost:3200/r/${SLUG}`);
  await expect(page.getByText(/yerel adresten açtınız/)).toBeVisible();
  const png = page.getByRole("link", { name: "PNG indir" });
  await expect(png).toHaveAttribute("download", `${SLUG}-qr.png`);
  await expect(page.getByRole("link", { name: "SVG indir" })).toHaveAttribute("href", /^data:image\/svg\+xml/);
  const wa = await page.getByRole("link", { name: "WhatsApp'ta paylaş" }).getAttribute("href");
  expect(decodeURIComponent(wa!)).toContain(`https://wa.me/?text=`);
  expect(decodeURIComponent(wa!)).toContain(`http://localhost:3200/r/${SLUG}`);
  // İndirilen PNG gerçekten bir görsel
  const dl = page.waitForEvent("download");
  await png.click();
  expect((await dl).suggestedFilename()).toBe(`${SLUG}-qr.png`);
  // Afiş yeni pencerede açılır (yazdırma penceresi testte engellenir)
  const popupP = context.waitForEvent("page");
  await page.getByRole("button", { name: "Afiş yazdır" }).click();
  const popup = await popupP;
  await expect(popup.getByRole("heading", { name: "Uygulamamızı telefonunuza ekleyin" })).toBeVisible();
  await expect(popup.getByText(`localhost:3200/r/${SLUG}`)).toBeVisible();
  await popup.close();
  // QR'daki adres uygulamaya yönlenir
  const r = await page.request.get(`/r/${SLUG}`, { maxRedirects: 0 });
  expect(r.status()).toBeGreaterThanOrEqual(300);
  expect(r.headers().location).toContain(`/r/${SLUG}/uygulama`);
});
