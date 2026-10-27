import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { apiGet, authFile, expectToast, uniq } from "./helpers";

test.use({ storageState: authFile("owner") });

type Tx = { id: string; type: string; category: string; amount: string; refundedAmount?: string; refundable?: string; staff: { displayName: string } | null };
const today = () => {
  const from = new Date(Date.now() - 2 * 3_600_000 * 12).toISOString();
  const to = new Date(Date.now() + 86_400_000).toISOString();
  return `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
};

test.describe.serial("Kasa", () => {
  test("gider ve gelir eklenir; özet güncellenir; CSV indirilir", async ({ page }) => {
    await page.goto("/panel/kasa");
    await page.getByRole("button", { name: "Gider ekle" }).click();
    let dlg = page.getByRole("dialog", { name: "Gider ekle" });
    await dlg.getByLabel("Kategori").fill("Malzeme");
    await dlg.getByLabel("Tutar (₺)").fill("320,50".replace(",", "."));
    await dlg.getByLabel("Yöntem").selectOption("TRANSFER");
    await dlg.getByRole("button", { name: "Kaydet" }).click();
    await expectToast(page, "Kaydedildi");
    await page.getByRole("button", { name: "Gelir ekle" }).click();
    dlg = page.getByRole("dialog", { name: "Gelir ekle" });
    await dlg.getByLabel("Kategori").fill("Diğer gelir");
    await dlg.getByLabel("Tutar (₺)").fill("1000");
    await dlg.getByRole("button", { name: "Kaydet" }).click();
    await expectToast(page, "Kaydedildi");
    await expect(page.getByRole("row").filter({ hasText: "MALZEME" })).toContainText("−₺320,50");
    const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "CSV indir" }).click()]);
    const csv = readFileSync((await dl.path())!, "utf8");
    expect(csv).toContain("MALZEME");
    expect(csv).toContain("-320,50");
  });

  test("kısmi iade; kalan tutardan fazlası reddedilir; tamamen iade edilen kayıtta iade butonu kalkar", async ({ page }) => {
    await page.goto("/panel/kasa");
    const row = page.getByRole("row").filter({ hasText: "DİĞER GELİR" });
    await row.getByRole("button", { name: "İade" }).click();
    let dlg = page.getByRole("dialog", { name: "İade" });
    await dlg.getByLabel(/İade tutarı/).fill("400");
    await dlg.getByLabel("Sebep").fill("Kısmi iade testi");
    await dlg.getByRole("button", { name: "İade et" }).click();
    await expectToast(page, "İade kaydedildi");
    await expect(row).toContainText("₺400,00 iade");
    await row.getByRole("button", { name: "İade" }).click();
    dlg = page.getByRole("dialog", { name: "İade" });
    await expect(dlg.getByLabel(/İade tutarı/)).toHaveValue("600");
    await dlg.getByLabel(/İade tutarı/).evaluate((el: HTMLInputElement) => el.removeAttribute("max"));
    await dlg.getByLabel(/İade tutarı/).fill("700");
    await dlg.getByLabel("Sebep").fill("Fazla iade denemesi");
    await dlg.getByRole("button", { name: "İade et" }).click();
    await expectToast(page, /kalan tutarı .*600,00 TL.* aşamaz|aşamaz/);
    await dlg.getByLabel(/İade tutarı/).fill("600");
    await dlg.getByRole("button", { name: "İade et" }).click();
    await expectToast(page, "İade kaydedildi");
    await expect(row.getByRole("button", { name: "İade" })).toHaveCount(0);
    const list = await apiGet<Tx[]>(page, `/finance/transactions?${today()}`);
    expect(list.find((t) => t.category === "DİĞER GELİR")).toMatchObject({ refundedAmount: "1000.00", refundable: "0.00" });
  });

  test("prim ödemesi kaydedilir ve kalan prim düşer", async ({ page }) => {
    await page.goto("/panel/kasa");
    await page.getByRole("button", { name: "30 gün" }).click();
    const row = page.getByRole("row").filter({ hasText: "Merve" }).filter({ has: page.getByRole("button", { name: "Öde" }) });
    const before = (await row.locator("td").nth(6).textContent())!;
    await row.getByRole("button", { name: "Öde" }).click();
    const dlg = page.getByRole("dialog", { name: "Prim ödemesi: Merve" });
    await dlg.getByLabel("Tutar (₺)").fill("100");
    await dlg.getByRole("button", { name: "Ödemeyi kaydet" }).click();
    await expectToast(page, "Prim ödemesi kaydedildi");
    const parse = (s: string) => Number(s.replace(/[^\d,]/g, "").replace(",", "."));
    await expect(async () => {
      const after = (await page.getByRole("row").filter({ hasText: "Merve" }).filter({ hasText: "%12" }).locator("td").nth(6).textContent())!;
      expect(parse(before) - parse(after)).toBeCloseTo(100, 2);
    }).toPass();
  });
});

test.describe.serial("Stok", () => {
  const name = uniq("Serum");

  test("ürün eklenir, düzenlenir, stok hareketi ve geçmişi", async ({ page }) => {
    await page.goto("/panel/stok");
    await page.getByRole("button", { name: "Ürün" }).click();
    const dlg = page.getByRole("dialog", { name: "Yeni ürün" });
    await dlg.getByLabel("Ürün adı").fill(name);
    await dlg.getByLabel("Tür").selectOption("RETAIL");
    await dlg.getByLabel("Açılış stoğu").fill("4");
    await dlg.getByLabel("Kritik seviye").fill("2");
    await dlg.getByLabel("Satış fiyatı (₺)").fill("350");
    await dlg.getByRole("button", { name: "Kaydet" }).click();
    await expectToast(page, "Ürün eklendi");
    const row = page.getByRole("row").filter({ hasText: name });
    await expect(row).toContainText("4 adet");
    await row.getByRole("button", { name: "Hareket" }).click();
    const mv = page.getByRole("dialog");
    await mv.getByLabel("Hareket").selectOption("IN");
    await mv.getByLabel("Miktar").fill("6");
    await mv.getByLabel("Not").fill("Tedarikçi teslimatı");
    await mv.getByRole("button", { name: "Kaydet" }).click();
    await expectToast(page, "Stok güncellendi");
    await expect(row).toContainText("10 adet");
    await row.getByRole("button", { name: "Düzenle" }).click();
    await page.getByRole("dialog").getByLabel("Satış fiyatı (₺)").fill("375");
    await page.getByRole("dialog").getByRole("button", { name: "Kaydet" }).click();
    await expectToast(page, "Ürün güncellendi");
    await row.getByRole("button", { name: "Geçmiş" }).click();
    await expect(page.getByRole("dialog").getByText("Tedarikçi teslimatı")).toBeVisible();
    await expect(page.getByRole("dialog").getByText("Açılış stoku")).toBeVisible();
  });

  test("perakende satış stoğu düşer, kasaya gelir yazar; yetersiz stok reddedilir", async ({ page }) => {
    await page.goto("/panel/stok");
    const row = page.getByRole("row").filter({ hasText: name });
    await row.getByRole("button", { name: "Sat" }).click();
    let dlg = page.getByRole("dialog");
    await dlg.getByLabel("Adet").fill("3");
    await dlg.getByRole("button", { name: "Satışı kaydet" }).click();
    await expectToast(page, "Satış kaydedildi");
    await expect(row).toContainText("7 adet");
    const tx = await apiGet<Tx[]>(page, `/finance/transactions?${today()}`);
    expect(tx.find((t) => t.category === "URUN_SATISI" && t.amount === "1125")).toBeTruthy();
    await row.getByRole("button", { name: "Sat" }).click();
    dlg = page.getByRole("dialog");
    await dlg.getByLabel("Adet").fill("50");
    await dlg.getByRole("button", { name: "Satışı kaydet" }).click();
    await expectToast(page, "Yetersiz stok");
    await page.reload();
    await expect(page.getByRole("row").filter({ hasText: name })).toContainText("7 adet");
  });

  test("kritik stok filtresi", async ({ page }) => {
    await page.goto("/panel/stok");
    await page.getByLabel("Yalnızca kritik stok").check();
    await expect(page.getByRole("row").filter({ hasText: "Güneş Kremi SPF50" })).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: "Lazer Jeli" })).toHaveCount(0);
  });
});
