import { expect, test } from "@playwright/test";
import { createHmac } from "node:crypto";
import { apiGet, authFile, expectToast } from "./helpers";

test.use({ storageState: authFile("owner") });

/**
 * WhatsApp kurulum sihirbazı, gelen mesaj → yapay zekâ yanıtı → personel devralma ve kampanya akışı.
 * Ortam test modundadır (META_MODE=mock, AI_MODE=mock): Meta'ya ve yapay zekâ sağlayıcısına istek gitmez.
 * Gerçek Meta hesabıyla denenmedi.
 */
test.describe.serial("WhatsApp & Instagram: kurulum sihirbazı ve mesajlar", () => {
  const phoneId = `30${Date.now().toString().slice(-11)}`;
  const appSecret = "e2e0aaaa0123456789abcdef01234567";
  let connId = "";
  let verifyToken = "";

  test("kampanya oluşturulur (asistan yalnızca bunu anlatır)", async ({ page }) => {
    await page.goto("/panel/kampanyalar");
    await page.getByRole("button", { name: "Yeni kampanya" }).click();
    await page.getByLabel("Başlık").fill("Kasım lazer indirimi");
    await page.getByLabel("Müşteriye anlatılacak metin").fill("Tüm lazer seanslarında %20 indirim, 30 Kasım'a kadar.");
    await page.getByRole("button", { name: "Kaydet" }).click();
    await expectToast(page, "Kampanya kaydedildi");
    await expect(page.getByText("Kasım lazer indirimi")).toBeVisible();
  });

  test("sihirbaz: hazırlık → bilgiler (şifreli) → doğrulama → webhook → şablonlar → yapay zekâ → deneme", async ({ page }) => {
    await page.goto("/panel/kanallar");
    await expect(page.getByText(/Test modu:/)).toBeVisible();
    await page.getByTestId("kanal-whatsapp").getByRole("button", { name: "Kurulumu başlat" }).click();
    const w = page.getByTestId("sihirbaz");
    await expect(w.getByText("Adım 1 / 7: Hazırlık")).toBeVisible();
    await expect(w.getByRole("button", { name: "Devam" })).toBeDisabled();
    await w.getByLabel("Gerekenler hazır").check();
    await w.getByRole("button", { name: "Devam" }).click();

    await w.getByLabel("Telefon numarası kimliği (Phone number ID)").fill(phoneId);
    await w.getByLabel("WhatsApp Business hesap kimliği (WABA ID)").fill("1000000099");
    await w.getByLabel("Kalıcı erişim anahtarı (access token)").fill("EAAe2eTOKEN0123456789abcdefWXYZ");
    await w.getByLabel("Uygulama gizli anahtarı (App secret)").fill("bu-gecerli-degil");
    await w.getByRole("button", { name: "Kaydet ve devam et" }).click();
    await expectToast(page, /32 karakterlik onaltılık/);
    await w.getByLabel("Uygulama gizli anahtarı (App secret)").fill(appSecret);
    await w.getByRole("button", { name: "Kaydet ve devam et" }).click();
    await expectToast(page, "Bilgiler şifrelenerek kaydedildi");

    // Anahtar API yanıtında hiçbir zaman açık görünmez.
    const list = await apiGet<{ connections: { id: string; channel: string; tokenHint: string }[] }>(page, "/channels");
    const conn = list.connections.find((c) => c.channel === "WHATSAPP")!;
    connId = conn.id;
    expect(conn.tokenHint).toBe("••••WXYZ");
    expect(JSON.stringify(list)).not.toContain("EAAe2eTOKEN");
    expect(JSON.stringify(list)).not.toContain(appSecret);

    await expect(w.getByText(/Adım 3 \/ 7: Doğrulama/)).toBeVisible();
    await w.getByRole("button", { name: "Bağlantıyı doğrula" }).click();
    await expectToast(page, /Test modunda doğrulandı/);

    await expect(w.getByText(/Adım 4 \/ 7: Webhook/)).toBeVisible();
    const callback = await w.getByRole("textbox", { name: "Geri çağırma adresi (Callback URL)" }).inputValue();
    expect(callback).toMatch(new RegExp(`/api/webhooks/meta/${connId}$`));
    await w.getByRole("button", { name: "Doğrulama belirtecini göster" }).click();
    verifyToken = await w.getByRole("textbox", { name: "Doğrulama belirteci (Verify token)" }).inputValue();
    expect(verifyToken.length).toBeGreaterThan(20);

    // Meta'nın yapacağı doğrulama isteği (web üzerinden API'ye aktarılır).
    const bad = await page.request.get(`${callback}?hub.mode=subscribe&hub.verify_token=yanlis&hub.challenge=42`);
    expect(bad.status()).toBe(403);
    const ok = await page.request.get(`${callback}?hub.mode=subscribe&hub.verify_token=${verifyToken}&hub.challenge=1158201444`);
    expect(ok.status()).toBe(200);
    expect(await ok.text()).toBe("1158201444");
    await w.getByRole("button", { name: "Durumu yenile" }).click();
    await expect(w.getByText(/Doğrulandı ·/)).toBeVisible();

    await w.getByRole("button", { name: "Sonraki adım" }).click();
    await expect(w.getByText(/Adım 5 \/ 7: Şablonlar/)).toBeVisible();
    await expect(w.getByRole("cell", { name: "randevu_hatirlatma" })).toBeVisible();
    await expect(w.getByRole("cell", { name: "kampanya_duyuru" })).toBeVisible();

    await w.getByRole("button", { name: "Sonraki adım" }).click();
    await expect(w.getByText(/Adım 6 \/ 7: Yapay zekâ/)).toBeVisible();
    const on = w.getByRole("button", { name: "Yapay zekâ yanıtlarını aç" });
    await expect(on).toBeDisabled();
    await w.getByLabel(/yurt dışındaki yapay zekâ hizmet sağlayıcısına/).check();
    await on.click();
    await expectToast(page, "Yapay zekâ yanıtları açıldı");
    await expect(w.getByText(/Durum: açık · onay:/)).toBeVisible();

    await w.getByRole("button", { name: "Sonraki adım" }).click();
    await expect(w.getByText(/Adım 7 \/ 7: Deneme/)).toBeVisible();
    await w.getByLabel("Deneme mesajının gideceği numara (kendi numaranız)").fill("05550001122");
    await w.getByLabel("Bu numaraya deneme mesajı gönderilmesini onaylıyorum").check();
    await w.getByRole("button", { name: "Deneme mesajı gönder" }).click();
    await expect(w.getByText("Test modu: mesaj GÖNDERİLMEDİ, yalnızca taklit edildi.")).toBeVisible();

    await expect(page.getByTestId("kanal-whatsapp").getByText("Bağlı", { exact: true })).toBeVisible();
    await expect(page.getByTestId("kanal-whatsapp").getByText("Yapay zekâ yanıtı: açık")).toBeVisible();
  });

  test("gelen mesaj: imzasız istek reddedilir; imzalı mesaja asistan kayıtlı kampanyayla yanıt verir; personel devralır", async ({ page }) => {
    const send = (text: string, id: string, secret = appSecret) => {
      const raw = JSON.stringify({
        object: "whatsapp_business_account",
        entry: [{ id: "1", changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { phone_number_id: phoneId }, contacts: [{ profile: { name: "Deniz Müşteri" }, wa_id: "905559998877" }], messages: [{ from: "905559998877", id, timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: text } }] } }] }],
      });
      const sig = "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");
      return page.request.post(`/api/webhooks/meta/${connId}`, { headers: { "Content-Type": "application/json", "X-Hub-Signature-256": sig }, data: raw });
    };
    expect((await send("sahte", "wamid.E2E0", "yanlis-gizli-anahtar")).status()).toBe(403);
    expect((await send("Merhaba, kampanyanız var mı?", "wamid.E2E1")).status()).toBe(200);

    await page.goto("/panel/mesajlar");
    await page.getByRole("button", { name: /Deniz Müşteri/ }).click();
    const t = page.getByTestId("konusma");
    await expect(t.getByText("Merhaba, kampanyanız var mı?")).toBeVisible();
    // Kuyruk 1,5 sn bekler; sayfa 8 sn'de bir yenilenir.
    await expect(t.getByText(/Kasım lazer indirimi: Tüm lazer seanslarında %20 indirim/)).toBeVisible({ timeout: 20_000 });
    await expect(t.getByText(/Yapay zekâ · .* · test modu — gönderilmedi/)).toBeVisible();

    await t.getByRole("button", { name: "Konuşmayı devral" }).click();
    await expect(t.getByRole("button", { name: "Yapay zekâya bırak" })).toBeVisible();
    await t.getByPlaceholder(/Yanıtınızı yazın/).fill("Merhaba Deniz Hanım, size yardımcı olayım.");
    await t.getByRole("button", { name: "Gönder" }).click();
    await expect(t.getByText("Merhaba Deniz Hanım, size yardımcı olayım.")).toBeVisible();
    await expect(t.getByText(/Personel · .* · test modu — gönderilmedi/)).toBeVisible();

    await page.getByRole("button", { name: "Personel bekleyenler" }).click();
    await expect(page.getByRole("button", { name: /Deniz Müşteri/ })).toBeVisible();
  });
});
