#!/usr/bin/env bash
# Pro Güzellik: yalnız web güncellemesi 570be85 → 1f94647 (SaaS paneli: sol yan menü + bildirim zili).
# API/worker kodu ve veritabanı değişmedi: api imajı yeniden etiketlenir, migration yok, yalnız web yeniden başlar.
# Kullanım (sunucuda): bash /opt/proguzellik/infra/production/deploy-web-1f94647.sh
set -Eeuo pipefail
cd /opt/proguzellik/infra/production
OLD=570be85 NEW=1f94647
STAMP=$(date +%Y%m%d-%H%M%S)
log() { printf '\n[%s] %s\n' "$(date '+%H:%M:%S')" "$*"; }
fail() { printf '\n*** DURDU: %s ***\n' "$*" >&2; printf 'Geri almak için (yalnızca Claude ile konuştuktan sonra): cd /opt/proguzellik/infra/production && ./rollback.sh %s\n' "$OLD" >&2; exit 1; }
trap 'fail "satır $LINENO başarısız oldu"' ERR

log "1/5 Ön kontrol"
grep -q "^APP_VERSION=$OLD$" .env || fail "Çalışan sürüm $OLD değil"
docker image inspect proguzellik-web:$NEW >/dev/null || fail "Yeni web imajı sunucuda yok"
docker image inspect proguzellik-api:$OLD >/dev/null || fail "API imajı $OLD bulunamadı"

log "2/5 Yedek (bütünlük kontrolüyle)"
./backup.sh
grep -q " OK " /opt/proguzellik/backups/last-status || fail "Yedek başarısız"

log "3/5 Çalışan sürümü arşivle"
./archive-image.sh "$OLD"

log "4/5 API imajını yeni etiketle işaretle (içerik aynı), sürümü güncelle"
docker tag proguzellik-api:$OLD proguzellik-api:$NEW
cp -p .env ".env.bak-$STAMP-$NEW"
sed -i "s/^APP_VERSION=.*/APP_VERSION=$NEW/" .env
status=$(docker compose run --rm migrate node dist/cli/migrate.js status 2>&1 || true)
echo "$status" | tail -2
echo "$status" | grep -q "up to date" || { sed -i "s/^APP_VERSION=.*/APP_VERSION=$OLD/" .env; fail "Bekleyen migration var; hiçbir şey değiştirilmedi"; }
docker compose up -d --no-deps web

log "5/5 Sağlık kontrolü (en fazla 2 dk)"
for i in $(seq 1 24); do
  h=$(docker inspect -f '{{.State.Health.Status}}' proguzellik-prod-web 2>/dev/null || echo yok)
  [[ "$h" == healthy ]] && break
  sleep 5
done
docker compose ps --format '{{.Name}} {{.Image}} {{.Status}}'
[[ "$h" == healthy ]] || fail "Web 2 dakikada sağlıklı olmadı (docker compose logs --tail 50 web)"
trap - ERR
log "TAMAM: web $NEW çalışıyor (api/worker aynı içerik). Bu çıktıyı Claude'a gönderin."
