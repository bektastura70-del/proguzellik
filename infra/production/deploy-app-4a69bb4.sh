#!/usr/bin/env bash
# Pro Güzellik: b369696 → 4a69bb4 (api + worker + web). ÖDEME KAPALI KALIR.
# İçerik: iyzico abonelik düzeltmeleri (abonelik detayı okuma, aktif abonelikte satın al düğmesi gizli) ve
#         "yalnız seçili işletmelerde sandbox pilotu" kapısı (IYZICO_PILOT_TENANTS). Yeni migration YOK.
#         Compose dosyası PAYMENT_MODE ve IYZICO_* değerlerini .env'den okur; .env'de yoksa varsayılan mock/boş = ödeme kapalı.
# Bu betik YALNIZCA Bektaş Tura'nın onayıyla çalıştırılır.
# Kullanım (sunucuda): bash /opt/proguzellik/infra/production/deploy-app-4a69bb4.sh
#
# Ne yapar: yedek + geri yükleme testi → çalışan imajı arşivler → compose dosyasını günceller (yedekli) → api/worker/web'i başlatır.
# Ne yapmaz: ödemeyi açmaz, iyzico anahtarı yazmaz, veritabanını değiştirmez, Caddy/DNS'e dokunmaz.
# Pilotu açmak ayrı adımdır: enable-iyzico-sandbox-pilot.sh (ayrı onay).
set -Eeuo pipefail
cd /opt/proguzellik/infra/production
OLD=b369696 NEW=4a69bb4
STAMP=$(date +%Y%m%d-%H%M%S)
env_get() { grep -E "^$1=" .env | tail -1 | cut -d= -f2- ; }
log() { printf '\n[%s] %s\n' "$(date '+%H:%M:%S')" "$*"; }
fail() { printf '\n*** DURDU: %s ***\n' "$*" >&2; printf 'Geri almak için (yalnızca Claude ile konuştuktan sonra): cd /opt/proguzellik/infra/production && cp -p docker-compose.yml.bak-%s-%s docker-compose.yml 2>/dev/null; ./rollback.sh %s\n' "$STAMP" "$NEW" "$OLD" >&2; exit 1; }
trap 'fail "satır $LINENO başarısız oldu"' ERR

log "1/7 Ön kontrol (çalışan: $OLD → yeni: $NEW)"
grep -q "^APP_VERSION=$OLD$" .env || fail "Çalışan sürüm $OLD değil ($(env_get APP_VERSION))"
docker image inspect proguzellik-api:$NEW proguzellik-web:$NEW >/dev/null || fail "Yeni imajlar sunucuda yok"
[[ -f docker-compose.yml.$NEW && -f docker-compose.yml.$OLD ]] || fail "docker-compose.yml.$NEW / .$OLD bulunamadı"
cmp -s docker-compose.yml docker-compose.yml.$OLD || fail "Sunucudaki docker-compose.yml depodaki $OLD sürümünden farklı (elle değişiklik?); üzerine yazılmadı"
grep -q 'PAYMENT_MODE: ${PAYMENT_MODE:-mock}' docker-compose.yml.$NEW || fail "Yeni compose dosyasında PAYMENT_MODE varsayılanı mock değil"
if grep -qE '^(PAYMENT_MODE|IYZICO_[A-Z_]+)=' .env; then fail ".env'de PAYMENT_MODE/IYZICO_ satırı var: bu dağıtım ödeme KAPALI yapılır"; fi

log "2/7 Yedek + geri yükleme testi (geçici veritabanına)"
RESTORE_TEST_WEEKDAY=$(date +%u) ./backup.sh
grep -q " OK " /opt/proguzellik/backups/last-status || fail "Yedek başarısız"
tail -6 /opt/proguzellik/backups/backup.log | grep -E "Kaynak|Yedek  |migration|TAMAM" || true

log "3/7 Çalışan sürümün imajını arşivle"
./archive-image.sh "$OLD"

log "4/7 Ayar dosyalarını yedekle, compose dosyasını ve sürümü güncelle"
cp -p .env ".env.bak-$STAMP-$NEW"; chmod 600 ".env.bak-$STAMP-$NEW"
cp -p docker-compose.yml "docker-compose.yml.bak-$STAMP-$NEW"
cp docker-compose.yml.$NEW docker-compose.yml
sed -i "s/^APP_VERSION=.*/APP_VERSION=$NEW/" .env
undo() { cp -p "docker-compose.yml.bak-$STAMP-$NEW" docker-compose.yml; sed -i "s/^APP_VERSION=.*/APP_VERSION=$OLD/" .env; }

log "5/7 Bekleyen veritabanı değişikliği olmamalı + ön denetim"
status=$(docker compose run --rm migrate node dist/cli/migrate.js status 2>&1 || true)
echo "$status" | tail -3
pending=$(echo "$status" | { grep -oE '[0-9]{14}_[a-z0-9_]+' || true; } | sort -u | tr '\n' ' ')
[[ -z "$pending" ]] || { undo; fail "Beklenmeyen migration var ($pending); hiçbir şey değiştirilmedi (dosyalar eski hâline döndü)"; }
./preflight.sh || { undo; fail "Ön denetim başarısız; hiçbir şey değiştirilmedi"; }

log "6/7 api/worker/web'i yeni sürümle başlat"
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
echo "API PAYMENT_MODE: $(docker exec proguzellik-prod-api printenv PAYMENT_MODE || echo yok) (mock beklenir; ödeme kapalı)"
echo "API iyzico anahtarı tanımlı mı: $([[ -n "$(docker exec proguzellik-prod-api printenv IYZICO_API_KEY 2>/dev/null)" ]] && echo EVET || echo hayır) (hayır beklenir)"
code=$(curl -s -o /dev/null -w '%{http_code}' https://proguzellik.com/ || echo hata)
echo "Site: $code (200 beklenir)"
trap - ERR
log "TAMAM: $NEW çalışıyor, ödeme kapalı. Geri dönüş: cp -p docker-compose.yml.bak-$STAMP-$NEW docker-compose.yml && ./rollback.sh $OLD. Bu çıktıyı Claude'a gönderin."
