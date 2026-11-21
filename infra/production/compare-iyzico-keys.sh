#!/usr/bin/env bash
# SALT OKUNUR: iyzico panelindeki canlı anahtarları sunucudakilerle karşılaştırır. Hiçbir şeyi değiştirmez.
# Anahtarlar gizli sorulur (ekrana yazılmaz), yalnızca SHA-256 özetleri karşılaştırılır; hiçbir değer yazdırılmaz/kaydedilmez.
# Kullanım (Mac'ten):
#   scp infra/production/compare-iyzico-keys.sh prososyalmedya:/opt/proguzellik/infra/production/
#   ssh -t prososyalmedya 'bash /opt/proguzellik/infra/production/compare-iyzico-keys.sh'
set -Eeuo pipefail
cd /opt/proguzellik/infra/production
h() { printf '%s' "$1" | sha256sum | cut -d' ' -f1; }
env_get() { { grep -E "^$1=" .env || true; } | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"; }
ctr_get() { docker exec proguzellik-prod-api printenv "$1" 2>/dev/null || true; }

echo "iyzico CANLI panel > Ayarlar > Firma Ayarları sayfasındaki değerleri yapıştırın (ekranda görünmez)."
echo "UYARI: Panelde 'Yenile/Yeniden oluştur' düğmesine BASMAYIN; mevcut anahtarı geçersiz kılar ve ödeme durur."
read -rsp "API Anahtarı: " IN_API; echo
read -rsp "Güvenlik Anahtarı (Secret): " IN_SECRET; echo
read -rp  "Üye İşyeri Numarası (Merchant ID, gizli değil): " IN_MID
IN_API=$(printf '%s' "$IN_API" | tr -d '[:space:]'); IN_SECRET=$(printf '%s' "$IN_SECRET" | tr -d '[:space:]'); IN_MID=$(printf '%s' "$IN_MID" | tr -d '[:space:]')

diffs=0
cmp() {
  local name=$1 key=$2 val=$3 e c
  e=$(env_get "$key"); c=$(ctr_get "$key")
  local re rc
  [[ "$(h "$val")" == "$(h "$e")" ]] && re="AYNI" || { re="FARKLI"; diffs=1; }
  [[ "$(h "$val")" == "$(h "$c")" ]] && rc="AYNI" || { rc="FARKLI"; diffs=1; }
  printf '%-22s .env: %-7s çalışan API: %s\n' "$name" "$re" "$rc"
}
echo
cmp "API Anahtarı" IYZICO_API_KEY "$IN_API"
cmp "Güvenlik Anahtarı" IYZICO_SECRET_KEY "$IN_SECRET"
cmp "Üye İşyeri No" IYZICO_MERCHANT_ID "$IN_MID"
[[ "$IN_API" == sandbox-* ]] && echo "UYARI: Girdiğiniz API anahtarı sandbox- ile başlıyor; canlı panelden almalısınız."
unset IN_API IN_SECRET
echo
if (( diffs == 0 )); then echo "SONUÇ: Hepsi aynı. Güncelleme gerekmez."; else echo "SONUÇ: Fark var. Hiçbir şey değiştirilmedi; Claude'a 'fark var' yazın, güncelleme betiği ayrı hazırlanacak."; fi
