#!/usr/bin/env bash
# Pro Güzellik: iyzico SANDBOX (test) ödemesini YALNIZ "Deneme" salonunda açar. GERÇEK PARA ÇEKİLMEZ.
# Bu betik YALNIZCA Bektaş Tura'nın onayıyla, Bektaş'ın kendi terminalinde çalıştırılır (anahtarlar gizli sorulur, ekrana yazılmaz).
# Kullanım (sunucuda): bash /opt/proguzellik/infra/production/enable-iyzico-sandbox-pilot.sh
#
# Ne yapar: Deneme salonunu bulur, onaylı fiyatları ve çıkış ağını kontrol eder, sandbox anahtarlarını sorar,
#           .env'yi yedekleyip PAYMENT_MODE=iyzico + anahtarlar + IYZICO_PILOT_TENANTS=<Deneme> yazar, api/worker'ı yeniden başlatır.
# Diğer salonlarda ödeme düğmesi görünmez ve API ödeme başlatmayı reddeder (503).
# Bağlantı adresi koddan gelir ve yalnız sandbox-api.iyzipay.com kabul edilir; canlı anahtar bu sürümde çalışmaz.
# Kapatmak: bash disable-iyzico-pilot.sh
set -Eeuo pipefail
cd /opt/proguzellik/infra/production
STAMP=$(date +%Y%m%d-%H%M%S)
env_get() { grep -E "^$1=" .env | tail -1 | cut -d= -f2- ; }
log() { printf '\n[%s] %s\n' "$(date '+%H:%M:%S')" "$*"; }
fail() { printf '\n*** DURDU: %s ***\nKapatmak için: bash disable-iyzico-pilot.sh\n' "$*" >&2; exit 1; }
trap 'fail "satır $LINENO başarısız oldu"' ERR
owner=$(env_get PG_OWNER_USER); db=$(env_get PG_DB)
q() { docker exec -i proguzellik-prod-postgres psql -X -tA -U "${owner:-proguzellik_owner}" -d "${db:-proguzellik}" -c "$1"; }

log "1/5 Ön kontrol"
[[ "$(env_get APP_VERSION)" == 4a69bb4 ]] || fail "APP_VERSION 4a69bb4 değil (önce deploy-app-4a69bb4.sh)"
grep -q 'IYZICO_PILOT_TENANTS: ${IYZICO_PILOT_TENANTS:-}' docker-compose.yml || fail "Compose dosyası pilotu tanımıyor"
[[ "$(env_get COMPOSE_FILE)" == *docker-compose.egress.yml* ]] || fail "COMPOSE_FILE'da docker-compose.egress.yml yok (api iyzico'ya ulaşamaz)"
[[ "$(env_get PRICING_PUBLIC)" != 0 ]] || fail "PRICING_PUBLIC=0: fiyatlar gizli, ödeme açılamaz"
tenant=$(q "SELECT id FROM \"Tenant\" WHERE slug='deneme'")
[[ "$tenant" =~ ^[0-9a-f-]{36}$ ]] || fail "slug=deneme olan tek bir salon bulunamadı"
echo "Deneme salonu: $(q "SELECT name||' · durum '||status||' · paket '||\"planCode\" FROM \"Tenant\" WHERE id='$tenant'")"
echo "Onaylı fiyatlar:"; q "SELECT \"planCode\"||' v'||coalesce(version::text,'-')||' aylık '||coalesce(\"monthlyPrice\"::text,'-')||' yıllık '||coalesce(\"yearlyPrice\"::text,'-') FROM \"PlanPrice\" WHERE status='APPROVED' AND \"effectiveFrom\"<=now() ORDER BY 1"
n=$(q "SELECT count(*) FROM \"PlanPrice\" WHERE status='APPROVED' AND \"effectiveFrom\"<=now()")
(( n > 0 )) || fail "Onaylı ve yürürlükte fiyat yok"
act=$(q "SELECT count(*) FROM \"Subscription\" WHERE \"tenantId\"='$tenant' AND status='ACTIVE'")
(( act == 0 )) || echo "UYARI: Deneme salonunda $act aktif abonelik var; deneme ödemesi için önce SaaS panelinden iptal edilmeli."

log "2/5 iyzico SANDBOX bilgileri (yazdıklarınız ekranda görünmez)"
read -rsp "Sandbox API anahtarı: " K; echo
read -rsp "Sandbox güvenlik anahtarı: " S; echo
read -rp  "Üye işyeri numarası (Merchant ID): " M
[[ "$K" == sandbox-* && "$S" == sandbox-* ]] || fail "Anahtarlar 'sandbox-' ile başlamıyor: bu adım yalnız test anahtarıyla yapılır"
[[ "$K" =~ ^[A-Za-z0-9-]{10,100}$ && "$S" =~ ^[A-Za-z0-9-]{10,100}$ ]] || fail "Anahtar biçimi beklenmedik (boşluk/özel karakter?)"
[[ "$M" =~ ^[0-9]{3,15}$ ]] || fail "Merchant ID yalnız rakam olmalı"

log "3/5 .env yedeği ve ayarlar"
cp -p .env ".env.bak-$STAMP-iyzico"; chmod 600 ".env.bak-$STAMP-iyzico"
sed -i -E '/^(PAYMENT_MODE|IYZICO_[A-Z_]+)=/d' .env
{ echo "PAYMENT_MODE=iyzico"; echo "IYZICO_API_KEY=$K"; echo "IYZICO_SECRET_KEY=$S"; echo "IYZICO_MERCHANT_ID=$M"; echo "IYZICO_PILOT_TENANTS=$tenant"; } >> .env
unset K S
chmod 600 .env
./preflight.sh || fail "Ön denetim başarısız"

log "4/5 api ve worker yeniden başlatılıyor"
docker compose up -d --no-deps api worker
for i in $(seq 1 36); do
  a=$(docker inspect -f '{{.State.Health.Status}}' proguzellik-prod-api 2>/dev/null || echo yok)
  w=$(docker inspect -f '{{.State.Health.Status}}' proguzellik-prod-worker 2>/dev/null || echo yok)
  [[ "$a" == healthy && "$w" == healthy ]] && break
  sleep 5
done
docker compose ps --format '{{.Name}} {{.Image}} {{.Status}}'
[[ "$a" == healthy && "$w" == healthy ]] || fail "api/worker 3 dakikada sağlıklı olmadı"

log "5/5 Doğrulama"
echo "API PAYMENT_MODE: $(docker exec proguzellik-prod-api printenv PAYMENT_MODE) (iyzico beklenir)"
echo "Pilot salon: $(docker exec proguzellik-prod-api printenv IYZICO_PILOT_TENANTS) (= $tenant)"
echo "iyzico sandbox erişimi: $(docker exec proguzellik-prod-api node -e "fetch('https://sandbox-api.iyzipay.com/payment/test').then(r=>r.json()).then(j=>console.log(j.status)).catch(e=>console.log('HATA '+e.message))") (success beklenir)"
trap - ERR
log "TAMAM: sandbox ödemesi yalnız Deneme salonunda açık. Sıradaki: iyzico SANDBOX panelinde bildirim adresini https://proguzellik.com/api/webhooks/iyzico yapın. Bu çıktıyı Claude'a gönderin (anahtarlar çıktıda yoktur)."
