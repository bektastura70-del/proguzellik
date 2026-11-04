#!/usr/bin/env bash
# Pro Güzellik: PWA V1.0 kodunu canlıya alma — ÖZELLİKLER KAPALI olarak (PWA_ENABLED=0, WEB_PUSH_MODE=off).
# Bu betik YALNIZCA Bektaş Tura'nın ayrıca onayıyla çalıştırılır (canlı dağıtım + canlı migration).
# Kullanım (sunucuda): bash /opt/proguzellik/infra/production/deploy-pwa-v1.sh <YENİ_SÜRÜM>
#
# Ne yapar: yedek + geri yükleme testi → eski imajı arşivler → compose dosyasını günceller →
#           2 migration'ı (yalnızca yeni tablo/sütun, veri silmez) uygular → api/worker/web'i başlatır.
# Ne yapmaz: hiçbir işletmede PWA'yı açmaz, push göndermez, Caddy/DNS'e dokunmaz.
# Hata olursa durur ve geri alma komutunu yazar; kendiliğinden geri almaz.
set -Eeuo pipefail
cd /opt/proguzellik/infra/production
NEW="${1:?Kullanım: deploy-pwa-v1.sh <YENİ_SÜRÜM>}"
[[ "$NEW" =~ ^[0-9a-f]{7,12}$ ]] || { echo "Geçersiz sürüm: $NEW"; exit 1; }
OLD=$(grep -E '^APP_VERSION=' .env | cut -d= -f2)
STAMP=$(date +%Y%m%d-%H%M%S)
log() { printf '\n[%s] %s\n' "$(date '+%H:%M:%S')" "$*"; }
fail() { printf '\n*** DURDU: %s ***\n' "$*" >&2; printf 'Geri almak için (yalnızca Claude ile konuştuktan sonra): cd /opt/proguzellik/infra/production && ./rollback.sh %s\n' "$OLD" >&2; exit 1; }
trap 'fail "satır $LINENO başarısız oldu"' ERR

log "1/8 Ön kontrol (çalışan: $OLD → yeni: $NEW)"
[[ -n "$OLD" && "$OLD" != "$NEW" ]] || fail "APP_VERSION okunamadı veya zaten $NEW"
docker image inspect proguzellik-api:$NEW proguzellik-web:$NEW >/dev/null || fail "Yeni imajlar sunucuda yok"
[[ -f docker-compose.yml.$NEW ]] || fail "docker-compose.yml.$NEW bulunamadı"
grep -q 'PWA_ENABLED: ${PWA_ENABLED:-0}' docker-compose.yml.$NEW || fail "Yeni compose dosyasında PWA_ENABLED varsayılanı 0 değil"
if grep -qE '^(PWA_ENABLED=1|WEB_PUSH_MODE=live)' .env; then fail ".env'de PWA_ENABLED=1 veya WEB_PUSH_MODE=live var: bu dağıtım özellikler KAPALI yapılır"; fi

log "2/8 Yedek + geri yükleme testi (geçici veritabanına)"
RESTORE_TEST_WEEKDAY=$(date +%u) ./backup.sh
grep -q " OK " /opt/proguzellik/backups/last-status || fail "Yedek başarısız"
tail -6 /opt/proguzellik/backups/backup.log | grep -E "Kaynak|Yedek  |migration|TAMAM" || true

log "3/8 Çalışan sürümün imajını arşivle"
./archive-image.sh "$OLD"

log "4/8 Ayar dosyalarını yedekle ve compose dosyasını güncelle"
cp -p .env ".env.bak-$STAMP-$NEW"
cp -p docker-compose.yml "docker-compose.yml.bak-$STAMP-$NEW"
cp docker-compose.yml.$NEW docker-compose.yml
diff "docker-compose.yml.bak-$STAMP-$NEW" docker-compose.yml || true

log "5/8 Bekleyen veritabanı değişiklikleri (yalnızca PWA migration'ları beklenir)"
sed -i "s/^APP_VERSION=.*/APP_VERSION=$NEW/" .env
status=$(docker compose run --rm migrate node dist/cli/migrate.js status 2>&1 || true)
echo "$status"
if ! echo "$status" | grep -q "20261104160000_pwa_v1" || ! echo "$status" | grep -q "20261104160100_pwa_v1_security"; then
  sed -i "s/^APP_VERSION=.*/APP_VERSION=$OLD/" .env
  cp "docker-compose.yml.bak-$STAMP-$NEW" docker-compose.yml
  fail "Beklenen PWA migration'ları listede yok; hiçbir şey değiştirilmedi (ayarlar eski hâline döndü)"
fi

log "6/8 Ön denetim (preflight)"
./preflight.sh || fail "Ön denetim başarısız"

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
docker compose run --rm migrate node dist/cli/migrate.js status 2>&1 | tail -3
# Eski akış aynen: PWA kapalıyken salon uygulaması adresleri 404 olmalı
code=$(docker exec proguzellik-prod-web node -e "fetch('http://localhost:3000/r/zz-yok/manifest.webmanifest').then(r=>console.log(r.status)).catch(()=>console.log('hata'))")
echo "Kapalı uygulama adresi yanıtı: $code (404 beklenir)"
trap - ERR
log "TAMAM: $NEW çalışıyor, PWA tüm işletmelerde KAPALI. Bu çıktıyı Claude'a gönderin."
