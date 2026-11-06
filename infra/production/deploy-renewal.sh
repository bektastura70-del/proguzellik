#!/usr/bin/env bash
# Pro Güzellik: yenilenme hatırlatması kodunu canlıya alma — ÖZELLİK KAPALI olarak (RENEWAL_REMINDERS=0, hiçbir salonda izin yok).
# Bu betik YALNIZCA Bektaş Tura'nın ayrıca onayıyla çalıştırılır (canlı dağıtım + canlı migration).
# Kullanım (sunucuda): bash /opt/proguzellik/infra/production/deploy-renewal.sh <YENİ_SÜRÜM>
#
# Ne yapar: yedek + geri yükleme testi → eski imajı arşivler → compose dosyasını günceller →
#           2 migration'ı uygular (yalnızca yeni sütunlar, hepsi varsayılan kapalı/boş; veri silmez/değiştirmez) → api/worker/web'i başlatır.
# Ne yapmaz: özelliği AÇMAZ, hiçbir salona izin vermez, müşteriye ileti göndermez, Caddy/DNS'e dokunmaz.
# Açmak ayrı adımdır: enable-renewal-pilot.sh, sonra SaaS panelinden yalnızca Deneme salonuna izin (docs/yenilenme-hatirlatmasi.md).
# Hata olursa durur ve geri alma komutunu yazar; kendiliğinden geri almaz.
set -Eeuo pipefail
cd /opt/proguzellik/infra/production
NEW="${1:?Kullanım: deploy-renewal.sh <YENİ_SÜRÜM>}"
[[ "$NEW" =~ ^[0-9a-f]{7,12}$ ]] || { echo "Geçersiz sürüm: $NEW"; exit 1; }
OLD=$(grep -E '^APP_VERSION=' .env | cut -d= -f2)
STAMP=$(date +%Y%m%d-%H%M%S)
env_get() { grep -E "^$1=" .env | tail -1 | cut -d= -f2- ; }
log() { printf '\n[%s] %s\n' "$(date '+%H:%M:%S')" "$*"; }
fail() { printf '\n*** DURDU: %s ***\n' "$*" >&2; printf 'Geri almak için (yalnızca Claude ile konuştuktan sonra): cd /opt/proguzellik/infra/production && ./rollback.sh %s\n' "$OLD" >&2; exit 1; }
trap 'fail "satır $LINENO başarısız oldu"' ERR

log "1/8 Ön kontrol (çalışan: $OLD → yeni: $NEW)"
[[ -n "$OLD" && "$OLD" != "$NEW" ]] || fail "APP_VERSION okunamadı veya zaten $NEW"
docker image inspect proguzellik-api:$NEW proguzellik-web:$NEW >/dev/null || fail "Yeni imajlar sunucuda yok"
[[ -f docker-compose.yml.$NEW ]] || fail "docker-compose.yml.$NEW bulunamadı"
grep -q 'RENEWAL_REMINDERS: ${RENEWAL_REMINDERS:-0}' docker-compose.yml.$NEW || fail "Yeni compose dosyasında RENEWAL_REMINDERS varsayılanı 0 değil"
if grep -qE '^RENEWAL_REMINDERS=1' .env; then fail ".env'de RENEWAL_REMINDERS=1 var: bu dağıtım özellik KAPALI yapılır"; fi

log "2/8 Yedek + geri yükleme testi (geçici veritabanına)"
RESTORE_TEST_WEEKDAY=$(date +%u) ./backup.sh
grep -q " OK " /opt/proguzellik/backups/last-status || fail "Yedek başarısız"
tail -6 /opt/proguzellik/backups/backup.log | grep -E "Kaynak|Yedek  |migration|TAMAM" || true

log "3/8 Çalışan sürümün imajını arşivle"
./archive-image.sh "$OLD"

log "4/8 Ayar dosyalarını yedekle ve compose dosyasını güncelle"
cp -p .env ".env.bak-$STAMP-$NEW"; chmod 600 ".env.bak-$STAMP-$NEW"
cp -p docker-compose.yml "docker-compose.yml.bak-$STAMP-$NEW"
cp docker-compose.yml.$NEW docker-compose.yml
diff "docker-compose.yml.bak-$STAMP-$NEW" docker-compose.yml || true

log "5/8 Bekleyen veritabanı değişiklikleri (yalnızca 2 yenilenme migration'ı beklenir)"
sed -i "s/^APP_VERSION=.*/APP_VERSION=$NEW/" .env
status=$(docker compose run --rm migrate node dist/cli/migrate.js status 2>&1 || true)
echo "$status"
pending=$(echo "$status" | { grep -oE '[0-9]{14}_[a-z0-9_]+' || true; } | sort -u | tr '\n' ' ')
if [[ "$pending" != "20261105160000_renewal_reminders 20261106090000_renewal_pilot " ]]; then
  sed -i "s/^APP_VERSION=.*/APP_VERSION=$OLD/" .env
  cp "docker-compose.yml.bak-$STAMP-$NEW" docker-compose.yml
  fail "Bekleyen migration'lar beklenenden farklı ($pending); hiçbir şey değiştirilmedi (ayarlar eski hâline döndü)"
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
owner=$(env_get PG_OWNER_USER); db=$(env_get PG_DB)
q() { docker exec -i proguzellik-prod-postgres psql -X -tA -U "${owner:-proguzellik_owner}" -d "${db:-proguzellik}" -c "$1"; }
echo "İzinli salon sayısı: $(q 'SELECT count(*) FROM "Tenant" WHERE "renewalRemindersAllowed" OR "renewalRemindersEnabled"') (0 beklenir)"
echo "Worker RENEWAL_REMINDERS: $(docker exec proguzellik-prod-worker printenv RENEWAL_REMINDERS || echo yok) (0 beklenir)"
trap - ERR
log "TAMAM: $NEW çalışıyor, yenilenme hatırlatması KAPALI. Bu çıktıyı Claude'a gönderin."
