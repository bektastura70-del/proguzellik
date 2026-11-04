#!/usr/bin/env bash
# Pro Güzellik: 8062bca → bdc1de8 canlıya alma (tek seferlik).
# Kullanım (sunucuda): bash /opt/proguzellik/infra/production/deploy-bdc1de8.sh
# Her adım doğrulanır; bir hata olursa betik durur ve geri alma komutunu yazar. Kendiliğinden geri almaz.
set -Eeuo pipefail
cd /opt/proguzellik/infra/production
OLD=8062bca NEW=bdc1de8
STAMP=$(date +%Y%m%d-%H%M%S)
log() { printf '\n[%s] %s\n' "$(date '+%H:%M:%S')" "$*"; }
fail() { printf '\n*** DURDU: %s ***\n' "$*" >&2; printf 'Geri almak için (yalnızca Claude ile konuştuktan sonra): cd /opt/proguzellik/infra/production && ./rollback.sh %s\n' "$OLD" >&2; exit 1; }
trap 'fail "satır $LINENO başarısız oldu"' ERR

log "1/7 Ön kontrol"
grep -q "^APP_VERSION=$OLD$" .env || fail "Çalışan sürüm $OLD değil"
docker image inspect proguzellik-api:$NEW proguzellik-web:$NEW >/dev/null || fail "Yeni imajlar sunucuda yok"
[[ -f docker-compose.yml.$NEW ]] || fail "docker-compose.yml.$NEW bulunamadı"

log "2/7 Yedek + geri yükleme testi (geçici veritabanına)"
RESTORE_TEST_WEEKDAY=$(date +%u) ./backup.sh
grep -q " OK " /opt/proguzellik/backups/last-status || fail "Yedek başarısız"
tail -6 /opt/proguzellik/backups/backup.log | grep -E "Kaynak|Yedek  |migration|TAMAM" || true

log "3/7 Çalışan sürümün imajını arşivle"
./archive-image.sh "$OLD"

log "4/7 Ayar dosyalarını yedekle ve compose dosyasını güncelle"
cp -p .env ".env.bak-$STAMP-$NEW"
cp -p docker-compose.yml "docker-compose.yml.bak-$STAMP-$NEW"
cp docker-compose.yml.$NEW docker-compose.yml
diff "docker-compose.yml.bak-$STAMP-$NEW" docker-compose.yml || true

log "5/7 Bekleyen veritabanı değişiklikleri"
sed -i "s/^APP_VERSION=.*/APP_VERSION=$NEW/" .env
status=$(docker compose run --rm migrate node dist/cli/migrate.js status 2>&1 || true)
echo "$status"
if ! echo "$status" | grep -q "20261031120000_messaging"; then
  sed -i "s/^APP_VERSION=.*/APP_VERSION=$OLD/" .env
  cp "docker-compose.yml.bak-$STAMP-$NEW" docker-compose.yml
  fail "Beklenen migration listede yok; hiçbir şey değiştirilmedi (ayarlar eski hâline döndü)"
fi

log "6/7 Migration uygula ve api/worker/web'i yeni sürümle başlat"
docker compose run --rm migrate
docker compose up -d api worker web

log "7/7 Sağlık kontrolü (en fazla 3 dk)"
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
docker compose run --rm migrate node dist/cli/migrate.js status 2>&1 | tail -3
trap - ERR
log "TAMAM: $NEW çalışıyor. Bu çıktıyı Claude'a gönderin."
