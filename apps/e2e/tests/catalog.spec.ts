import { expect, test } from "@playwright/test";
import { apiGet, authFile, expectToast, uniq } from "./helpers";

test.use({ storageState: authFile("owner") });

test.describe.serial("Hizmetler, personel ve paketler", () => {
  const svcName = uniq("Kaş Laminasyonu");
  const staffName = uniq("Aylin");
  const pkgName = uniq("5 Seans Kaş");

  test("kategori yönetimi: ekle, yeniden adlandır, kullanılan kategori silinemez", async ({ page }) => {
    await page.goto("/panel/hizmetler");
    await page.getByRole("button", { name: "Kategoriler" }).click();
    const dlg = page.getByRole("dialog", { name: "Hizmet kategorileri" });
    await dlg.getByLabel("Yeni kategori adı").fill("Kaş & Kirpik");
    await dlg.getByRole("button", { name: "Ekle" }).click();
    await expectToast(page, "Kategori eklendi");
    await dlg.getByLabel("Cilt Bakımı adı").fill("Cilt Bakımı ");
    const row = dlg.getByRole("listitem").filter({ has: page.getByLabel("Cilt Bakımı adı") });
    await row.getByRole("button", { name: "Sil" }).click();
    await expect(page.getByText(/hizmet var; önce hizmetleri taşıyın/)).toBeVisible();
    await page.keyboard.press("Escape");
  });

  test("hizmet eklenir ve düzenlenir", async ({ page }) => {
    await page.goto("/panel/hizmetler");
    await page.getByRole("button", { name: "Hizmet" }).click();
    const dlg = page.getByRole("dialog", { name: "Yeni hizmet" });
    await dlg.getByLabel("Hizmet adı").fill(svcName);
    await dlg.getByLabel("Kategori").selectOption({ label: "Kaş & Kirpik" });
    await dlg.getByLabel("Süre (dk)").fill("40");
    await dlg.getByLabel("Fiyat (₺)").fill("650");
    await dlg.getByRole("button", { name: "Kaydet" }).click();
    await expectToast(page, "Hizmet kaydedildi");
    const row = page.getByRole("row").filter({ hasText: svcName });
    await expect(row).toContainText("40 dk");
    await row.getByRole("button", { name: "Düzenle" }).click();
    await page.getByRole("dialog").getByLabel("Fiyat (₺)").fill("700");
    await page.getByRole("dialog").getByRole("button", { name: "Kaydet" }).click();
    await expectToast(page, "Hizmet kaydedildi");
    await page.reload();
    await expect(page.getByRole("row").filter({ hasText: svcName })).toContainText("₺700,00");
  });

  test("personel eklenir, hizmet atanır, çalışma saatleri kaydedilir", async ({ page }) => {
    await page.goto("/panel/personel");
    await page.getByRole("button", { name: "Personel" }).click();
    const dlg = page.getByRole("dialog", { name: "Yeni personel" });
    await dlg.getByLabel("Görünen ad").fill(staffName);
    await dlg.getByLabel("Hizmet primi %").fill("18");
    await dlg.getByText(svcName).click();
    await dlg.getByRole("button", { name: "Kaydet" }).click();
    await expectToast(page, "Personel kaydedildi");
    const card = page.locator("div").filter({ has: page.getByText(staffName, { exact: true }) }).filter({ has: page.getByRole("button", { name: "Çalışma saatleri" }) }).last();
    await expect(card).toContainText("Prim oranı: %18");
    await card.getByRole("button", { name: "Çalışma saatleri" }).click();
    const h = page.getByRole("dialog");
    await h.getByLabel("Pazartesi").check();
    await h.getByLabel("Salı").check();
    await h.getByRole("button", { name: "Kaydet" }).click();
    await expectToast(page, "Çalışma saatleri kaydedildi");
    await page.reload();
    const staff = await apiGet<{ displayName: string; workingHours: { weekday: number }[]; services: { serviceId: string }[] }[]>(page, "/staff");
    const s = staff.find((x) => x.displayName === staffName)!;
    expect(s.workingHours.map((w) => w.weekday).sort()).toEqual([1, 2]);
    expect(s.services).toHaveLength(1);
  });

  test("paket şablonu oluşturulur, düzenlenir ve müşteriye satılır", async ({ page }) => {
    await page.goto("/panel/paketler");
    await page.getByRole("button", { name: "Paket şablonu" }).click();
    const dlg = page.getByRole("dialog", { name: "Yeni paket şablonu" });
    await dlg.getByLabel("Paket adı").fill(pkgName);
    await dlg.getByLabel("Hizmet").selectOption({ label: svcName });
    await dlg.getByLabel("Seans").fill("5");
    await dlg.getByLabel("Fiyat (₺)").fill("2500");
    await dlg.getByRole("button", { name: "Kaydet" }).click();
    const row = page.getByRole("row").filter({ hasText: pkgName });
    await expect(row).toContainText("₺500,00/seans");
    await row.getByRole("button", { name: "Düzenle" }).click();
    await page.getByRole("dialog").getByLabel("Fiyat (₺)").fill("2250");
    await page.getByRole("dialog").getByRole("button", { name: "Kaydet" }).click();
    await expectToast(page, "Paket şablonu güncellendi");
    await row.getByRole("button", { name: "Sat" }).click();
    const sell = page.getByRole("dialog", { name: `Paket sat: ${pkgName}` });
    await sell.getByPlaceholder("Ad, soyad veya telefonla ara…").fill("Gizem");
    await sell.getByRole("button", { name: /Gizem Öztürk/ }).click();
    await expect(sell.getByLabel("Satış fiyatı (₺)")).toHaveValue("2250");
    await sell.getByLabel("Peşin tahsilat (₺)").fill("1000");
    await sell.getByRole("button", { name: "Satışı tamamla" }).click();
    await expectToast(page, "Paket satıldı");
    const customers = await apiGet<{ items: { id: string }[] }>(page, "/customers?search=Gizem");
    const pk = await apiGet<{ name: string; totalSessions: number; price: string }[]>(page, `/customers/${customers.items[0].id}/packages`);
    expect(pk.find((p) => p.name === pkgName)).toMatchObject({ totalSessions: 5, price: "2250" });
    const bal = await apiGet<{ balance: string }>(page, `/customers/${customers.items[0].id}/balance`);
    expect(Number(bal.balance)).toBeGreaterThanOrEqual(1250);
  });
});

test.describe("Personel sınırı (Başlangıç paketi: 3)", () => {
  test.use({ storageState: authFile("other") });
  test("4. aktif personel eklenemez ve açık hata gösterilir", async ({ page }) => {
    await page.goto("/panel/personel");
    for (const n of ["P1", "P2", "P3"]) {
      await page.getByRole("button", { name: "Personel" }).click();
      await page.getByRole("dialog").getByLabel("Görünen ad").fill(n);
      await page.getByRole("dialog").getByRole("button", { name: "Kaydet" }).click();
      await expectToast(page, "Personel kaydedildi");
    }
    await page.getByRole("button", { name: "Personel" }).click();
    await page.getByRole("dialog").getByLabel("Görünen ad").fill("P4");
    await page.getByRole("dialog").getByRole("button", { name: "Kaydet" }).click();
    await expect(page.getByRole("dialog").getByText(/Başlangıç paketinde en fazla 3 aktif personel/)).toBeVisible();
    const staff = await apiGet<unknown[]>(page, "/staff");
    expect(staff).toHaveLength(3);
  });
});
