#!/usr/bin/env bash
# Pro Güzellik: iyzico CANLI ödemesini açar. GERÇEK KARTLARDAN PARA ÇEKİLİR.
# Bu betik YALNIZCA Bektaş Tura'nın açık onayıyla, kendi terminalinde (ssh -t) çalıştırılır; anahtarlar gizli sorulur.
# Kullanım (sunucuda):
#   bash enable-iyzico-live.sh deneme   → yalnız Deneme salonunda canlı ödeme (ilk deneme)
#   bash enable-iyzico-live.sh hepsi    → tüm salonlarda canlı ödeme (ayrı onayla)
#
# Ne yapar: yedek + geri yükleme testi → .env yedeği → sandbox test ödemelerini "iyzico_sandbox" (TEST) olarak işaretler ve
#           sandbox test aboneliklerini kapatır (iyzico'da aranmasınlar) → canlı adres/anahtar/salon listesini yazar → api/worker'ı yeniden başlatır.
# Canlı anahtarlar zaten yazılıysa (deneme → hepsi geçişi) yeniden sorulmaz, yalnız salon listesi değişir.
# Kapatmak: bash disable-iyzico-pilot.sh (tüm salonlarda ödeme kapanır; mevcut iyzico abonelikleri iyzico'da sürer, gerekirse panelden iptal).
set -Eeuo pipefail
cd /opt/proguzellik/infra/production
MODE="${1:-}"
[[ "$MODE" == deneme || "$MODE" == hepsi ]] || { echo "Kullanım: enable-iyzico-live.sh deneme|hepsi"; exit 1; }
LIVE=https://api.iyzipay.com
STAMP=$(date +%Y%m%d-%H%M%S)
env_get() { grep -E "^$1=" .env | tail -1 | cut -d= -f2- ; }
log() { printf '\n[%s] %s\n' "$(date '+%H:%M:%S')" "$*"; }
fail() { printf '\n*** DURDU: %s ***\nÖdemeyi kapatmak için: bash disable-iyzico-pilot.sh\n' "$*" >&2; exit 1; }
trap 'fail "satır $LINENO başarısız oldu"' ERR
owner=$(env_get PG_OWNER_USER); db=$(env_get PG_DB)
q() { docker exec -i proguzellik-prod-postgres psql -X -tA -v ON_ERROR_STOP=1 -U "${owner:-proguzellik_owner}" -d "${db:-proguzellik}" -c "$1"; }

log "1/6 Ön kontrol (mod: $MODE)"
[[ "$(env_get APP_VERSION)" == 82f094c ]] || fail "APP_VERSION 82f094c değil (önce deploy-app-82f094c.sh)"
grep -q 'IYZICO_BASE_URL: ${IYZICO_BASE_URL:-https://sandbox-api.iyzipay.com}' docker-compose.yml || fail "Compose dosyası iyzico adresini tanımıyor"
[[ "$(env_get COMPOSE_FILE)" == *docker-compose.egress.yml* ]] || fail "COMPOSE_FILE'da docker-compose.egress.yml yok (api iyzico'ya ulaşamaz)"
[[ "$(env_get PRICING_PUBLIC)" != 0 ]] || fail "PRICING_PUBLIC=0: fiyatlar gizli, ödeme açılamaz"
echo "Onaylı ve yürürlükteki fiyatlar (KDV hariç):"
q "SELECT \"planCode\"||' v'||coalesce(version::text,'-')||': aylık '||\"monthlyPrice\"::text||' TL, yıllık '||coalesce(\"yearlyPrice\"::text,'-')||' TL, KDV %'||coalesce(\"vatRate\"::text,'-') FROM \"PlanPrice\" WHERE status='APPROVED' AND \"effectiveFrom\"<=now() ORDER BY 1"
n=$(q "SELECT count(*) FROM \"PlanPrice\" WHERE status='APPROVED' AND \"effectiveFrom\"<=now()")
(( n > 0 )) || fail "Onaylı ve yürürlükte fiyat yok"
if [[ "$MODE" == deneme ]]; then
  pilot=$(q "SELECT id FROM \"Tenant\" WHERE slug='deneme'")
  [[ "$pilot" =~ ^[0-9a-f-]{36}$ ]] || fail "slug=deneme olan tek bir salon bulunamadı"
  where="yalnız Deneme salonunda"
else
  pilot='*'
  where="TÜM salonlarda ($(q 'SELECT count(*) FROM "Tenant"') salon)"
fi
echo
echo "Bu adım $where GERÇEK ödemeyi açar. Yukarıdaki fiyatlar gerçek kartlardan çekilecek tutarlardır (üzerine KDV)."
read -rp "Onaylıyorsanız büyük harflerle GERCEK ODEME yazın: " ok
[[ "$ok" == "GERCEK ODEME" ]] || fail "Onay verilmedi; hiçbir şey değiştirilmedi"

reuse=0
if [[ "$(env_get IYZICO_BASE_URL)" == "$LIVE" && -n "$(env_get IYZICO_API_KEY)" && -n "$(env_get IYZICO_SECRET_KEY)" && -n "$(env_get IYZICO_MERCHANT_ID)" ]]; then
  reuse=1; log "2/6 Canlı anahtarlar zaten tanımlı; yeniden sorulmuyor"
else
  log "2/6 iyzico CANLI bilgileri (yazdıklarınız ekranda görünmez)"
  read -rsp "Canlı API anahtarı: " K; echo
  read -rsp "Canlı güvenlik anahtarı: " S; echo
  read -rp  "Üye işyeri numarası (Merchant ID): " M
  [[ "$K" != sandbox-* && "$S" != sandbox-* ]] || fail "Bunlar test (sandbox) anahtarı; canlı panelden canlı anahtarları alın"
  [[ "$K" =~ ^[A-Za-z0-9-]{10,100}$ && "$S" =~ ^[A-Za-z0-9-]{10,100}$ ]] || fail "Anahtar biçimi beklenmedik (boşluk/özel karakter?)"
  [[ "$M" =~ ^[0-9]{3,15}$ ]] || fail "Merchant ID yalnız rakam olmalı"
fi

log "3/6 Yedek + geri yükleme testi"
RESTORE_TEST_WEEKDAY=$(date +%u) ./backup.sh
grep -q " OK " /opt/proguzellik/backups/last-status || fail "Yedek başarısız"
cp -p .env ".env.bak-$STAMP-iyzico-live"; chmod 600 ".env.bak-$STAMP-iyzico-live"

log "4/6 Sandbox test kayıtları ayrılıyor (yalnız sandbox ödeme oturumlarına bağlı olanlar)"
SB="SELECT \"subscriptionId\" FROM \"IyzicoCheckout\" WHERE environment='sandbox' AND \"subscriptionId\" IS NOT NULL"
echo "Test olarak işaretlenen ödeme: $(q "WITH u AS (UPDATE \"SubscriptionPayment\" SET provider='iyzico_sandbox', description=description||' (TEST)' WHERE provider='iyzico' AND \"subscriptionId\" IN ($SB) RETURNING 1) SELECT count(*) FROM u")"
echo "Kapatılan test aboneliği: $(q "WITH u AS (UPDATE \"Subscription\" SET status='CANCELLED', \"cancelAtPeriodEnd\"=true WHERE provider='iyzico' AND status<>'CANCELLED' AND id IN ($SB) RETURNING 1) SELECT count(*) FROM u")"

log "5/6 Ayarlar ve yeniden başlatma"
if (( reuse )); then
  sed -i -E '/^IYZICO_PILOT_TENANTS=/d' .env
  echo "IYZICO_PILOT_TENANTS=$pilot" >> .env
else
  sed -i -E '/^(PAYMENT_MODE|IYZICO_[A-Z_]+)=/d' .env
  { echo "PAYMENT_MODE=iyzico"; echo "IYZICO_BASE_URL=$LIVE"; echo "IYZICO_API_KEY=$K"; echo "IYZICO_SECRET_KEY=$S"; echo "IYZICO_MERCHANT_ID=$M"; echo "IYZICO_PILOT_TENANTS=$pilot"; } >> .env
  unset K S
fi
chmod 600 .env
./preflight.sh || fail "Ön denetim başarısız"
docker compose up -d --no-deps api worker
for i in $(seq 1 36); do
  a=$(docker inspect -f '{{.State.Health.Status}}' proguzellik-prod-api 2>/dev/null || echo yok)
  w=$(docker inspect -f '{{.State.Health.Status}}' proguzellik-prod-worker 2>/dev/null || echo yok)
  [[ "$a" == healthy && "$w" == healthy ]] && break
  sleep 5
done
docker compose ps --format '{{.Name}} {{.Image}} {{.Status}}'
[[ "$a" == healthy && "$w" == healthy ]] || fail "api/worker 3 dakikada sağlıklı olmadı"

log "6/6 Doğrulama"
echo "API iyzico adresi: $(docker exec proguzellik-prod-api printenv IYZICO_BASE_URL) ($LIVE beklenir)"
echo "Açık salonlar: $(docker exec proguzellik-prod-api printenv IYZICO_PILOT_TENANTS)"
echo "iyzico canlı erişimi: $(docker exec proguzellik-prod-api node -e "fetch('$LIVE/payment/test').then(r=>r.json()).then(j=>console.log(j.status)).catch(e=>console.log('HATA '+e.message))") (success beklenir)"
docker logs --since 2m proguzellik-prod-api 2>&1 | grep -E "PAYMENT_MODE=iyzico" | tail -1 || true
trap - ERR
log "TAMAM: gerçek ödeme $where açık. iyzico CANLI panelinde bildirim adresi https://proguzellik.com/api/webhooks/iyzico olmalı. Bu çıktıyı Claude'a gönderin (anahtarlar çıktıda yoktur)."
