import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { apiGet, authFile, expectToast, uniq } from "./helpers";

test.use({ storageState: authFile("owner") });

type C = { id: string; firstName: string; lastName: string; phone: string | null; tags: string[]; kvkkConsentAt: string | null; anonymizedAt?: string | null };

test.describe.serial("Müşteri CRM ve KVKK", () => {
  const last = uniq("Testoğlu").split(" ")[1];
  let id = "";

  test("müşteri eklenir, aranır ve sayfa yenilenince korunur", async ({ page }) => {
    await page.goto("/panel/musteriler");
    await page.getByRole("button", { name: "Müşteri" }).click();
    const dlg = page.getByRole("dialog", { name: "Yeni müşteri" });
    await dlg.getByLabel("Ad", { exact: true }).fill("Canan");
    await dlg.getByLabel("Soyad").fill(last);
    await dlg.getByLabel("Telefon").fill("0555 777 66 55");
    await dlg.getByLabel("Etiketler").fill("VIP, Gelin");
    await dlg.getByText("KVKK aydınlatma metni müşteriye sunuldu").click();
    await dlg.getByRole("button", { name: "Kaydet" }).click();
    await expectToast(page, "Müşteri eklendi");
    await page.getByPlaceholder("Ad, telefon veya e-posta").fill(last);
    await page.getByRole("button", { name: "Ara" }).click();
    await expect(page.getByRole("link", { name: `Canan ${last}` })).toBeVisible();
    await page.reload();
    const res = await apiGet<{ items: C[] }>(page, `/customers?search=${encodeURIComponent(last)}`);
    expect(res.items).toHaveLength(1);
    expect(res.items[0]).toMatchObject({ phone: "05557776655", tags: ["VIP", "Gelin"] });
    expect(res.items[0].kvkkConsentAt).toBeTruthy();
    id = res.items[0].id;
  });

  test("aynı telefonla ikinci müşteri eklenemez", async ({ page }) => {
    await page.goto("/panel/musteriler");
    await page.getByRole("button", { name: "Müşteri" }).click();
    const dlg = page.getByRole("dialog", { name: "Yeni müşteri" });
    await dlg.getByLabel("Ad", { exact: true }).fill("Kopya");
    await dlg.getByLabel("Soyad").fill("Kişi");
    await dlg.getByLabel("Telefon").fill("05557776655");
    await dlg.getByRole("button", { name: "Kaydet" }).click();
    await expect(dlg.getByText("Bu telefon numarası ile kayıtlı müşteri var")).toBeVisible();
  });

  test("etiket filtresi çalışır", async ({ page }) => {
    await page.goto("/panel/musteriler");
    await page.getByRole("button", { name: "VIP" }).click();
    await expect(page.getByRole("link", { name: `Canan ${last}` })).toBeVisible();
    await expect(page.getByRole("link", { name: "Zeynep Kaya" })).toHaveCount(0);
  });

  test("müşteri kartı: düzenleme, not, tahsilat ve bakiye", async ({ page }) => {
    await page.goto(`/panel/musteriler/${id}`);
    await page.getByRole("button", { name: "Düzenle" }).click();
    const dlg = page.getByRole("dialog", { name: "Müşteriyi düzenle" });
    await dlg.getByLabel("E-posta").fill("canan@ornek.test");
    await dlg.getByRole("button", { name: "Kaydet" }).click();
    await expectToast(page, "Müşteri güncellendi");
    await expect(page.getByText("canan@ornek.test")).toBeVisible();

    await page.getByPlaceholder("Alerji, tercih, cilt tipi…").fill("Lateks alerjisi var");
    await page.getByRole("button", { name: "Not ekle" }).click();
    await expectToast(page, "Not eklendi");
    await expect(page.getByText("Lateks alerjisi var")).toBeVisible();

    await page.getByRole("button", { name: "Tahsilat al" }).click();
    const pay = page.getByRole("dialog", { name: "Tahsilat al" });
    await pay.getByLabel("Tutar (₺)").fill("250");
    await pay.getByRole("button", { name: "Kaydet" }).click();
    await expectToast(page, "Tahsilat kaydedildi");
    await page.reload();
    await expect(page.getByText("Lateks alerjisi var")).toBeVisible();
    const bal = await apiGet<{ payments: string }>(page, `/customers/${id}/balance`);
    expect(bal.payments).toBe("250.00");
  });

  test("KVKK: veri dışa aktarma dosyası indirilir ve doğru veriyi içerir", async ({ page }) => {
    await page.goto(`/panel/musteriler/${id}`);
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Verileri dışa aktar/ }).click()]);
    const data = JSON.parse(readFileSync((await download.path())!, "utf8"));
    expect(data.customer).toMatchObject({ id, firstName: "Canan", email: "canan@ornek.test" });
    expect(data.notes[0].body).toBe("Lateks alerjisi var");
    expect(data.transactions).toHaveLength(1);
  });

  test("KVKK: anonimleştirme kişisel veriyi siler, mali kaydı korur", async ({ page }) => {
    await page.goto(`/panel/musteriler/${id}`);
    await page.getByRole("button", { name: "Anonimleştir" }).click();
    await page.getByRole("dialog", { name: "Müşteriyi anonimleştir" }).getByRole("button", { name: "Anonimleştir" }).click();
    await expectToast(page, "Müşteri anonimleştirildi");
    await expect(page).toHaveURL(/\/panel\/musteriler$/);
    const c = await apiGet<C & { email: string | null; notes: string | null }>(page, `/customers/${id}`);
    expect(c).toMatchObject({ firstName: "Anonim", lastName: "Müşteri", phone: null, email: null, tags: [] });
    const bal = await apiGet<{ payments: string }>(page, `/customers/${id}/balance`);
    expect(bal.payments).toBe("250.00");
  });
});
