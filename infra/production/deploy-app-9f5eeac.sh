#!/usr/bin/env bash
# Pro Güzellik: 326e50f veya d081736 → 9f5eeac (bildirim sesi/simge sayısı, iPhone form alanı düzeltmesi).
# Veritabanı değişikliği YOK: migration beklenmez; bekleyen migration varsa hiçbir şey değiştirmeden durur.
# Kullanım (sunucuda): bash /opt/proguzellik/infra/production/deploy-app-9f5eeac.sh
set -Eeuo pipefail
cd /opt/proguzellik/infra/production
NEW=9f5eeac
OLD=$(grep -E '^APP_VERSION=' .env | cut -d= -f2)
STAMP=$(date +%Y%m%d-%H%M%S)
log() { printf '\n[%s] %s\n' "$(date '+%H:%M:%S')" "$*"; }
fail() { printf '\n*** DURDU: %s ***\n' "$*" >&2; printf 'Geri almak için (yalnızca Claude ile konuştuktan sonra): cd /opt/proguzellik/infra/production && ./rollback.sh %s\n' "$OLD" >&2; exit 1; }
trap 'fail "satır $LINENO başarısız oldu"' ERR

log "1/5 Ön kontrol (çalışan: $OLD → yeni: $NEW)"
[[ "$OLD" == 326e50f || "$OLD" == d081736 ]] || fail "Çalışan sürüm 326e50f veya d081736 değil ($OLD)"
docker image inspect proguzellik-api:$NEW proguzellik-web:$NEW >/dev/null || fail "Yeni imajlar sunucuda yok"

log "2/5 Yedek (bütünlük kontrolüyle)"
./backup.sh
grep -q " OK " /opt/proguzellik/backups/last-status || fail "Yedek başarısız"

log "3/5 Çalışan sürümü arşivle"
docker image inspect proguzellik-api:$OLD >/dev/null 2>&1 || docker tag proguzellik-api:326e50f proguzellik-api:$OLD
./archive-image.sh "$OLD"

log "4/5 Sürümü güncelle (migration beklenmez)"
cp -p .env ".env.bak-$STAMP-$NEW"
sed -i "s/^APP_VERSION=.*/APP_VERSION=$NEW/" .env
status=$(docker compose run --rm migrate node dist/cli/migrate.js status 2>&1 || true)
echo "$status" | tail -2
echo "$status" | grep -q "up to date" || { sed -i "s/^APP_VERSION=.*/APP_VERSION=$OLD/" .env; fail "Bekleyen migration var; hiçbir şey değiştirilmedi"; }
docker compose up -d --no-deps api worker web

log "5/5 Sağlık kontrolü (en fazla 3 dk)"
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
trap - ERR
log "TAMAM: $NEW çalışıyor. Bu çıktıyı Claude'a gönderin."
