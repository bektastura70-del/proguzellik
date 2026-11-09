#!/usr/bin/env bash
# Pro Güzellik: e389c8c → b369696 (api + worker + web).
# İçerik: ürün satış fişi, ürün primi, stoklu iade, ürün satış raporu, ürün KDV'si, kritik stok e-postası,
#         randevu tahsilatına ürün ekleme. Aradaki iyzico Abonelik kodu da gelir ama canlıda KAPALI kalır
#         (compose PAYMENT_MODE=mock + NODE_ENV=production → çevrimiçi ödeme devre dışı).
# Bu betik YALNIZCA Bektaş Tura'nın onayıyla çalıştırılır (onay: 09.11.2026 "canlıya al").
# Kullanım (sunucuda): bash /opt/proguzellik/infra/production/deploy-app-b369696.sh
#
# Ne yapar: yedek + geri yükleme testi → çalışan imajı arşivler → 3 migration'ı uygular
#           (yalnızca yeni tablolar/sütunlar, varsayılanlı; mevcut veri silinmez/değiştirilmez) → api/worker/web'i başlatır.
# Ne yapmaz: compose dosyasını, .env'deki ayarları (APP_VERSION hariç), Caddy'yi, DNS'i değiştirmez; ödeme açmaz.
# Hata olursa durur ve geri alma komutunu yazar; kendiliğinden geri almaz.
set -Eeuo pipefail
cd /opt/proguzellik/infra/production
OLD=e389c8c NEW=b369696
EXPECTED="20261107150000_iyzico_subscriptions 20261109090000_product_sales 20261109120000_product_vat_lowstock "
STAMP=$(date +%Y%m%d-%H%M%S)
env_get() { grep -E "^$1=" .env | tail -1 | cut -d= -f2- ; }
log() { printf '\n[%s] %s\n' "$(date '+%H:%M:%S')" "$*"; }
fail() { printf '\n*** DURDU: %s ***\n' "$*" >&2; printf 'Geri almak için (yalnızca Claude ile konuştuktan sonra): cd /opt/proguzellik/infra/production && ./rollback.sh %s\n' "$OLD" >&2; exit 1; }
trap 'fail "satır $LINENO başarısız oldu"' ERR

log "1/8 Ön kontrol (çalışan: $OLD → yeni: $NEW)"
grep -q "^APP_VERSION=$OLD$" .env || fail "Çalışan sürüm $OLD değil ($(env_get APP_VERSION))"
docker image inspect proguzellik-api:$NEW proguzellik-web:$NEW >/dev/null || fail "Yeni imajlar sunucuda yok"
grep -q 'PAYMENT_MODE: mock' docker-compose.yml || fail "docker-compose.yml'de PAYMENT_MODE: mock yok (ödeme kapalı kalmalı)"

log "2/8 Yedek + geri yükleme testi (geçici veritabanına)"
RESTORE_TEST_WEEKDAY=$(date +%u) ./backup.sh
grep -q " OK " /opt/proguzellik/backups/last-status || fail "Yedek başarısız"
tail -6 /opt/proguzellik/backups/backup.log | grep -E "Kaynak|Yedek  |migration|TAMAM" || true

log "3/8 Çalışan sürümün imajını arşivle"
./archive-image.sh "$OLD"

log "4/8 Ayar dosyasını yedekle, sürümü güncelle"
cp -p .env ".env.bak-$STAMP-$NEW"; chmod 600 ".env.bak-$STAMP-$NEW"
sed -i "s/^APP_VERSION=.*/APP_VERSION=$NEW/" .env

log "5/8 Bekleyen veritabanı değişiklikleri (yalnızca 3 migration beklenir)"
status=$(docker compose run --rm migrate node dist/cli/migrate.js status 2>&1 || true)
echo "$status"
pending=$(echo "$status" | { grep -oE '[0-9]{14}_[a-z0-9_]+' || true; } | sort -u | tr '\n' ' ')
if [[ "$pending" != "$EXPECTED" ]]; then
  sed -i "s/^APP_VERSION=.*/APP_VERSION=$OLD/" .env
  fail "Bekleyen migration'lar beklenenden farklı ($pending); hiçbir şey değiştirilmedi (APP_VERSION eski hâline döndü)"
fi

log "6/8 Ön denetim (preflight)"
./preflight.sh || { sed -i "s/^APP_VERSION=.*/APP_VERSION=$OLD/" .env; fail "Ön denetim başarısız; hiçbir şey değiştirilmedi"; }

log "7/8 Migration uygula ve api/worker/web'i yeni sürümle başlat"
docker compose run --rm migrate
docker compose up -d api worker web

log "8/8 Sağlık kontrolü (en fazla 3 dk)"
for i in $(seq 1 36); do
  bad=0
  for c in api worker web; do
    h=$(docker inspect -f '{{.State.Health.Status}}' "proguzellik-prod-$c" 2>/dev/null || echo yok)
    [[ "$h" == healthy ]] || bad=1
  done
  (( bad == 0 )) && break
  sleep 5
done
docker compose ps --format '{{.Name}} {{.Image}} {{.Status}}'
(( bad == 0 )) || fail "Konteynerler 3 dakikada sağlıklı olmadı (docker compose logs --tail 50 api web worker)"
docker compose run --rm migrate node dist/cli/migrate.js status 2>&1 | tail -2
owner=$(env_get PG_OWNER_USER); db=$(env_get PG_DB)
q() { docker exec -i proguzellik-prod-postgres psql -X -tA -U "${owner:-proguzellik_owner}" -d "${db:-proguzellik}" -c "$1"; }
echo "Satış fişi tablosu: $(q 'SELECT count(*) FROM "ProductSale"') kayıt (0 beklenir)"
echo "Kritik stok e-postası açık salon: $(q 'SELECT count(*) FROM "Tenant" WHERE "lowStockEmailEnabled"') / $(q 'SELECT count(*) FROM "Tenant"')"
echo "API PAYMENT_MODE: $(docker exec proguzellik-prod-api printenv PAYMENT_MODE || echo yok) (mock beklenir; canlıda ödeme kapalı)"
code=$(curl -s -o /dev/null -w '%{http_code}' https://proguzellik.com/ || echo hata)
echo "Site: $code (200 beklenir)"
trap - ERR
log "TAMAM: $NEW çalışıyor. Geri dönüş gerekirse: ./rollback.sh $OLD (veritabanı yeni sütunlarla uyumludur). Bu çıktıyı Claude'a gönderin."
