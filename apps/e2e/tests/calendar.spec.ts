import { expect, test } from "@playwright/test";
import { apiGet, authFile, expectToast } from "./helpers";

test.use({ storageState: authFile("owner") });

type Appt = { id: string; startsAt: string; status: string; price: string; customer: { firstName: string; lastName: string }; staff: { displayName: string } };

/** Önümüzdeki ilk pazartesi (demo personeli Pzt–Cmt çalışır) */
function nextMonday() {
  const d = new Date(Date.now() + 3 * 3_600_000);
  do d.setUTCDate(d.getUTCDate() + 1);
  while (d.getUTCDay() !== 1);
  return d.toISOString().slice(0, 10);
}
const DAY = nextMonday();
const iso = (hhmm: string) => new Date(`${DAY}T${hhmm}:00+03:00`).toISOString();
const range = `from=${encodeURIComponent(iso("00:00"))}&to=${encodeURIComponent(new Date(new Date(iso("00:00")).getTime() + 86_400_000).toISOString())}`;

let createdId = "";

test.describe.serial("Randevu takvimi", () => {
  test("gün/hafta/ay görünümleri ve URL'de kalıcılık", async ({ page }) => {
    await page.goto(`/panel/takvim?gorunum=gun&tarih=${DAY}`);
    await expect(page.getByTestId("col-Elif")).toBeVisible();
    await expect(page.getByTestId("col-Merve")).toBeVisible();
    await page.getByRole("tab", { name: "Hafta" }).click();
    await expect(page).toHaveURL(/gorunum=hafta/);
    await expect(page.getByTestId(`col-${DAY}`)).toBeVisible();
    await page.getByRole("tab", { name: "Ay" }).click();
    await expect(page.getByTestId("month-grid")).toBeVisible();
    await page.reload();
    await expect(page.getByTestId("month-grid")).toBeVisible();
    await page.getByRole("button", { name: new RegExp(`^${DAY}:`) }).click();
    await expect(page).toHaveURL(new RegExp(`gorunum=gun&tarih=${DAY}`));
  });

  test("boş hücreden hızlı randevu: boş saat önerisi ve kayıt", async ({ page }) => {
    await page.goto(`/panel/takvim?gorunum=gun&tarih=${DAY}`);
    await page.getByTestId("col-Selin").getByRole("button", { name: "18:00 için randevu ekle" }).click();
    const dlg = page.getByRole("dialog", { name: "Yeni randevu" });
    await dlg.getByPlaceholder("Ad, soyad veya telefonla ara…").fill("Derya");
    await dlg.getByRole("button", { name: /Derya Aydın/ }).click();
    await dlg.getByLabel("Hizmet").selectOption({ label: "Kalıcı Oje · 45 dk · ₺450,00" });
    await expect(dlg.getByTestId("slot-list")).toBeVisible();
    await expect(dlg.getByLabel("Saat", { exact: true })).toHaveValue("18:00");
    await dlg.getByLabel("Not", { exact: true }).fill("E2E hızlı randevu");
    await dlg.getByRole("button", { name: "Randevuyu kaydet" }).click();
    await expectToast(page, "Randevu oluşturuldu");
    // Veritabanında kalıcı mı?
    const list = await apiGet<Appt[]>(page, `/appointments?${range}`);
    const created = list.find((a) => a.customer.firstName === "Derya" && a.startsAt === iso("18:00"));
    expect(created?.staff.displayName).toBe("Selin");
    createdId = created!.id;
    await page.reload();
    await expect(page.getByTestId("col-Selin").getByText("18:00 Derya Aydın")).toBeVisible();
  });

  test("çakışan randevu reddedilir ve hata gösterilir", async ({ page }) => {
    await page.goto(`/panel/takvim?gorunum=gun&tarih=${DAY}`);
    await page.getByTestId("col-Selin").getByRole("button", { name: "19:00 için randevu ekle" }).click();
    const dlg = page.getByRole("dialog", { name: "Yeni randevu" });
    await dlg.getByPlaceholder("Ad, soyad veya telefonla ara…").fill("Ece");
    await dlg.getByRole("button", { name: /Ece Kurt/ }).click();
    await dlg.getByLabel("Hizmet").selectOption({ label: "Kalıcı Oje · 45 dk · ₺450,00" });
    await dlg.getByLabel("Personel").selectOption({ label: "Selin" });
    await dlg.getByLabel("Saat", { exact: true }).fill("18:15");
    await dlg.getByRole("button", { name: "Randevuyu kaydet" }).click();
    await expect(dlg.getByText(/başka bir randevusu var|müsait değil/)).toBeVisible();
  });

  test("sürükle-bırak ile randevu başka saate taşınır", async ({ page }) => {
    await page.goto(`/panel/takvim?gorunum=gun&tarih=${DAY}`);
    const appt = page.locator(`[data-appt-id="${createdId}"]`);
    const target = page.getByTestId("col-Selin").getByRole("button", { name: "17:00 için randevu ekle" });
    await appt.dragTo(target, { targetPosition: { x: 20, y: 2 } });
    await expectToast(page, /17:00 saatine taşındı/);
    const list = await apiGet<Appt[]>(page, `/appointments?${range}`);
    expect(list.find((a) => a.id === createdId)?.startsAt).toBe(iso("17:00"));
  });

  test("izin/blok eklenir, takvimde görünür ve o saate randevu verilemez", async ({ page }) => {
    await page.goto(`/panel/takvim?gorunum=gun&tarih=${DAY}`);
    await page.getByRole("button", { name: "İzin / blok" }).click();
    const dlg = page.getByRole("dialog", { name: "İzin / blok ekle" });
    await dlg.getByLabel("Personel").selectOption({ label: "Merve" });
    await dlg.getByLabel("Başlangıç saati").fill("14:00");
    await dlg.getByLabel("Bitiş saati").fill("15:30");
    await dlg.getByLabel("Sebep").fill("Eğitim");
    await dlg.getByRole("button", { name: "Kaydet" }).click();
    await expectToast(page, "İzin eklendi");
    await expect(page.getByTestId("col-Merve").getByText("İzin · Eğitim")).toBeVisible();
    const slots = await apiGet<{ startsAt: string; staffName: string }[]>(page, `/availability?date=${DAY}&serviceId=${(await apiGet<{ id: string; name: string }[]>(page, "/services")).find((s) => s.name === "Klasik Cilt Bakımı")!.id}`);
    expect(slots.filter((s) => s.staffName === "Merve").map((s) => s.startsAt)).not.toContain(iso("14:00"));
    // İzni kaldır
    await page.getByTestId("col-Merve").getByText("İzin · Eğitim").click();
    await page.getByRole("dialog", { name: "İzin / blok" }).getByRole("button", { name: "İzni kaldır" }).click();
    await expectToast(page, "İzin kaldırıldı");
    await expect(page.getByTestId("col-Merve").getByText("İzin · Eğitim")).toHaveCount(0);
  });

  test("randevu detayı: düzenle/ertele, tamamla, tahsilat al", async ({ page }) => {
    await page.goto(`/panel/takvim?gorunum=gun&tarih=${DAY}`);
    await page.locator(`[data-appt-id="${createdId}"]`).click();
    const dlg = page.getByRole("dialog");
    await dlg.getByRole("button", { name: "Düzenle / ertele" }).click();
    await dlg.getByLabel("Saat", { exact: true }).fill("16:30");
    await dlg.getByLabel("Fiyat (₺)").fill("500");
    await dlg.getByRole("button", { name: "Kaydet" }).click();
    await expectToast(page, "Randevu güncellendi");
    await expect(page.locator(`[data-appt-id="${createdId}"]`)).toContainText("16:30 Derya");
    await page.locator(`[data-appt-id="${createdId}"]`).click();
    await page.getByRole("dialog").getByRole("button", { name: "Onayla" }).click();
    await expectToast(page, "Durum: Onaylandı");
    await page.locator(`[data-appt-id="${createdId}"]`).click();
    await page.getByRole("dialog").getByRole("button", { name: "Tamamlandı" }).click();
    const pay = page.getByRole("dialog", { name: "Tahsilat" });
    await expect(pay.getByLabel("Tutar (₺)")).toHaveValue("500");
    await pay.getByLabel("Yöntem").selectOption("CASH");
    await pay.getByRole("button", { name: "Tahsil et" }).click();
    await expectToast(page, "Tahsilat kaydedildi");
    const list = await apiGet<Appt[]>(page, `/appointments?${range}`);
    const a = list.find((x) => x.id === createdId)!;
    expect(a).toMatchObject({ status: "COMPLETED", price: "500", startsAt: iso("16:30") });
    const tx = await apiGet<{ appointmentId: string | null; amount: string; method: string }[]>(page, `/finance/transactions?from=${encodeURIComponent(new Date(Date.now() - 60_000).toISOString())}&to=${encodeURIComponent(new Date(Date.now() + 60_000).toISOString())}`);
    expect(tx.find((t) => t.appointmentId === a.id)).toMatchObject({ amount: "500", method: "CASH" });
  });

  test("iptal sebebiyle iptal; 'İptalleri göster' ile görünür", async ({ page }) => {
    await page.goto(`/panel/takvim?gorunum=gun&tarih=${DAY}`);
    const first = page.getByTestId("col-Elif").getByTestId("appt").first();
    const label = (await first.textContent())!.slice(0, 5);
    await first.click();
    await page.getByRole("dialog").getByRole("button", { name: "İptal et" }).click();
    await page.getByRole("dialog").getByLabel("İptal sebebi").fill("Müşteri talebi");
    await page.getByRole("dialog").getByRole("button", { name: "İptal et" }).click();
    await expectToast(page, "Durum: İptal");
    await expect(page.getByTestId("col-Elif").getByTestId("appt").filter({ hasText: label })).toHaveCount(0);
    await page.getByLabel("İptalleri göster").check();
    await expect(page.getByTestId("col-Elif").getByTestId("appt").filter({ hasText: label })).toHaveCount(1);
  });
});
