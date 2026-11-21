#!/usr/bin/env bash
# SALT OKUNUR: canlı API kapsayıcısındaki iyzico anahtarlarıyla iyzico'ya iki zararsız sorgu.
# Ücretlendirme yapmaz, iyzico'da kayıt oluşturmaz, anahtar yazdırmaz.
#   1) Kart BIN sorgusu (kimlik doğrulama çalışıyor mu)
#   2) Abonelik ürünlerini LİSTELEME (Abonelik hesapta açık mı; kapalıysa 100001 döner)
# Kullanım (Mac'ten):
#   scp infra/production/check-iyzico-auth.sh prososyalmedya:/opt/proguzellik/infra/production/
#   ssh -t prososyalmedya 'bash /opt/proguzellik/infra/production/check-iyzico-auth.sh'
set -Eeuo pipefail
docker exec -i proguzellik-prod-api node - <<'JS'
const c = require("crypto");
const { IYZICO_API_KEY: k, IYZICO_SECRET_KEY: s, IYZICO_BASE_URL: b } = process.env;
if (!k || !s || !b) { console.log("iyzico anahtarı/adresi tanımlı değil"); process.exit(1); }
const h = (path, body = "") => {
  const r = String(Date.now()) + Math.random().toString().slice(2, 8);
  const sig = c.createHmac("sha256", s).update(r + path + body).digest("hex");
  return { Authorization: "IYZWSv2 " + Buffer.from(`apiKey:${k}&randomKey:${r}&signature:${sig}`).toString("base64"), "x-iyzi-rnd": r, "Content-Type": "application/json" };
};
(async () => {
  console.log("Adres:", b, "| sandbox anahtarı mı:", k.startsWith("sandbox-") ? "EVET (UYARI)" : "hayır");
  const body = JSON.stringify({ locale: "tr", binNumber: "552879" });
  let r = await fetch(b + "/payment/bin/check", { method: "POST", headers: h("/payment/bin/check", body), body });
  let j = await r.json();
  console.log("1) Kimlik doğrulama:", j.status === "success" ? "TAMAM" : "HATA", r.status, j.errorCode || "", j.errorMessage || "");
  const p = "/v2/subscription/products";
  r = await fetch(b + p + "?page=1&count=20", { headers: h(p) });
  j = await r.json();
  console.log("2) Abonelik ürünü:", j.status === "success" ? "AÇIK" : "KAPALI/HATA", r.status, j.errorCode || "", j.errorMessage || "", "| ürün sayısı:", j.data?.totalCount ?? (j.data?.items || []).length);
})().catch((e) => { console.log("HATA:", e.message); process.exit(1); });
JS
