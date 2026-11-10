#!/usr/bin/env bash
# Pro Güzellik: 87bafa1 → b69491e (api + worker + web). Siteden satın alma ayarı (.env PURCHASE_ENABLED) olduğu gibi kalır.
# İçerik: yeni salonlar için başlangıç sihirbazı (/panel/baslangic, GET/PATCH /onboarding, genel bakışta kurulum kartı).
#         1 migration: 20261110120000_onboarding (Tenant."onboardingDismissedAt" boş sütun + app_tenant için UPDATE izni; mevcut veri değişmez).
#         Compose dosyası değişmedi; mevcut salonların ödemesi ve randevuları olduğu gibi kalır.
# Bu betik YALNIZCA Bektaş Tura'nın onayıyla çalıştırılır.
# Kullanım (sunucuda): bash /opt/proguzellik/infra/production/deploy-app-b69491e.sh
#
# Ne yapar: yedek + geri yükleme testi → çalışan imajı arşivler → compose dosyasını günceller (yedekli) → migration → api/worker/web.
# Ne yapmaz: satın alma ayarını değiştirmez, iyzico anahtarlarına dokunmaz, Caddy/DNS'e dokunmaz.
set -Eeuo pipefail
cd /opt/proguzellik/infra/production
OLD=87bafa1 NEW=b69491e
EXPECTED="20261110120000_onboarding "
STAMP=$(date +%Y%m%d-%H%M%S)
env_get() { grep -E "^$1=" .env | tail -1 | cut -d= -f2- ; }
log() { printf '\n[%s] %s\n' "$(date '+%H:%M:%S')" "$*"; }
fail() { printf '\n*** DURDU: %s ***\n' "$*" >&2; printf 'Geri almak için (yalnızca Claude ile konuştuktan sonra): cd /opt/proguzellik/infra/production && cp -p docker-compose.yml.bak-%s-%s docker-compose.yml 2>/dev/null; ./rollback.sh %s\n' "$STAMP" "$NEW" "$OLD" >&2; exit 1; }
trap 'fail "satır $LINENO başarısız oldu"' ERR

log "1/8 Ön kontrol (çalışan: $OLD → yeni: $NEW)"
grep -q "^APP_VERSION=$OLD$" .env || fail "Çalışan sürüm $OLD değil ($(env_get APP_VERSION))"
docker image inspect proguzellik-api:$NEW proguzellik-web:$NEW >/dev/null || fail "Yeni imajlar sunucuda yok"
[[ -f docker-compose.yml.$NEW && -f docker-compose.yml.$OLD ]] || fail "docker-compose.yml.$NEW / .$OLD bulunamadı"
cmp -s docker-compose.yml docker-compose.yml.$OLD || fail "Sunucudaki docker-compose.yml depodaki $OLD sürümünden farklı (elle değişiklik?); üzerine yazılmadı"
grep -q 'PURCHASE_ENABLED: ${PURCHASE_ENABLED:-0}' docker-compose.yml.$NEW || fail "Yeni compose dosyasında satın alma varsayılanı kapalı değil"
PURCHASE_BEFORE=$(env_get PURCHASE_ENABLED); echo "Siteden satın alma ayarı: ${PURCHASE_BEFORE:-0} (değiştirilmeyecek)"

log "2/8 Yedek + geri yükleme testi (geçici veritabanına)"
RESTORE_TEST_WEEKDAY=$(date +%u) ./backup.sh
grep -q " OK " /opt/proguzellik/backups/last-status || fail "Yedek başarısız"
tail -6 /opt/proguzellik/backups/backup.log | grep -E "Kaynak|Yedek  |migration|TAMAM" || true

log "3/8 Çalışan sürümün imajını arşivle"
./archive-image.sh "$OLD"

log "4/8 Ayar dosyalarını yedekle, compose dosyasını ve sürümü güncelle"
cp -p .env ".env.bak-$STAMP-$NEW"; chmod 600 ".env.bak-$STAMP-$NEW"
cp -p docker-compose.yml "docker-compose.yml.bak-$STAMP-$NEW"
cp docker-compose.yml.$NEW docker-compose.yml
sed -i "s/^APP_VERSION=.*/APP_VERSION=$NEW/" .env
undo() { cp -p "docker-compose.yml.bak-$STAMP-$NEW" docker-compose.yml; sed -i "s/^APP_VERSION=.*/APP_VERSION=$OLD/" .env; }

log "5/8 Bekleyen veritabanı değişiklikleri (yalnızca 1 migration beklenir)"
status=$(docker compose run --rm migrate node dist/cli/migrate.js status 2>&1 || true)
echo "$status" | tail -4
pending=$(echo "$status" | { grep -oE '[0-9]{14}_[a-z0-9_]+' || true; } | sort -u | tr '\n' ' ')
[[ "$pending" == "$EXPECTED" ]] || { undo; fail "Bekleyen migration'lar beklenenden farklı ($pending); hiçbir şey değiştirilmedi (dosyalar eski hâline döndü)"; }

log "6/8 Ön denetim (preflight)"
./preflight.sh || { undo; fail "Ön denetim başarısız; hiçbir şey değiştirilmedi"; }

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
st=$(docker exec proguzellik-prod-api node -e "fetch('http://localhost:4000/purchase/status').then(r=>r.text()).then(console.log).catch(()=>console.log('hata'))")
want=false; [[ "${PURCHASE_BEFORE:-0}" == "1" ]] && want=true
echo "Satın alma durumu: $st ({\"enabled\":$want} beklenir, yayından önceki gibi)"
echo "API PAYMENT_MODE: $(docker exec proguzellik-prod-api printenv PAYMENT_MODE) · iyzico adresi: $(docker exec proguzellik-prod-api printenv IYZICO_BASE_URL)"
code=$(curl -s -o /dev/null -w '%{http_code}' https://proguzellik.com/fiyatlar || echo hata)
echo "Fiyatlar sayfası: $code (200 beklenir)"
echo "Kurulum sütunu: $(q "SELECT count(*) FROM information_schema.columns WHERE table_name='Tenant' AND column_name='onboardingDismissedAt'") (1 beklenir)"
oc=$(docker exec proguzellik-prod-api node -e "fetch('http://localhost:4000/onboarding').then(r=>console.log(r.status)).catch(()=>console.log('hata'))")
echo "Kurulum uç noktası girişsiz: $oc (401 beklenir)"
pc=$(curl -s -o /dev/null -w '%{http_code}' https://proguzellik.com/panel/baslangic || echo hata)
echo "Sihirbaz sayfası: $pc (200 beklenir)"
trap - ERR
log "TAMAM: $NEW çalışıyor (başlangıç sihirbazı açık), satın alma ayarı değişmedi. Geri dönüş: cp -p docker-compose.yml.bak-$STAMP-$NEW docker-compose.yml && ./rollback.sh $OLD. Bu çıktıyı Claude'a gönderin."
