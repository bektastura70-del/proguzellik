#!/usr/bin/env bash
# Pro Güzellik: 4ec7d00 → 4296795 (api + worker + web). Bektaş Tura'nın onayıyla (mahalle listeden seçilsin; köy yok).
# İçerik:
#  - Mahalle, rehber kartında il ve ilçeden sonra İçişleri Bakanlığı resmî mahalle listesinden seçilir (32.306 mahalle;
#    src/directory/tr-neighborhoods.ts). Serbest metin mahalle girişi kaldırıldı. Rehberde ilçe sayfasında mahalle filtresi
#    (yalnızca salonu olan mahalleler).
#  - 1 migration (yalnızca ekleme): 20261116150000_salon_neighborhood: "SalonListing"e boş "neighborhoodSlug" sütunu
#    (+ kısıt, işletme rolüne yazma izni). Mevcut satırların değerleri değişmez.
#  - Veri: yalnızca demo salon. Serbest metin "Kirişçi Mahallesi", listedeki Karaman › Merkez › Kirişçi ("kirisci") ile
#    eşleştirilir; denetim kaydıyla. Gerçek salonların verisine dokunulmaz.
# Kullanım (Mac'ten): ssh -t prososyalmedya 'bash /opt/proguzellik/infra/production/deploy-app-4296795.sh'
# Ne yapmaz: .env'de APP_VERSION dışında hiçbir ayara (Meta, satın alma, iyzico, yapay zekâ, Web Push), Caddy/DNS'e ve diğer
# projelere dokunmaz. Yeni sürüm başladıktan sonra sağlık/duman testi başarısız olursa otomatik olarak $OLD'a döner
# (yeni sütun kalır; eski sürüm onu okumaz).
set -Eeuo pipefail
cd /opt/proguzellik/infra/production
OLD=4ec7d00 NEW=4296795
EXPECTED="20261116150000_salon_neighborhood "
STAMP=$(date +%Y%m%d-%H%M%S)
STARTED=0
env_get() { grep -E "^$1=" .env | tail -1 | cut -d= -f2- ; }
log() { printf '\n[%s] %s\n' "$(date '+%H:%M:%S')" "$*"; }
undo() { cp -p "docker-compose.yml.bak-$STAMP-$NEW" docker-compose.yml; cp -p ".env.bak-$STAMP-$NEW" .env; }
fail() {
  trap - ERR
  printf '\n*** DURDU: %s ***\n' "$*" >&2
  if (( STARTED == 1 )); then
    printf '\nOtomatik geri dönüş: %s\n' "$OLD" >&2
    undo || true
    ./rollback.sh "$OLD" || printf 'Geri dönüş BAŞARISIZ; elle: cp -p docker-compose.yml.bak-%s-%s docker-compose.yml && cp -p .env.bak-%s-%s .env && ./rollback.sh %s\n' "$STAMP" "$NEW" "$STAMP" "$NEW" "$OLD" >&2
    docker compose ps --format '{{.Name}} {{.Image}} {{.Status}}' >&2 || true
  fi
  exit 1
}
trap 'fail "satır $LINENO başarısız oldu"' ERR
owner=$(env_get PG_OWNER_USER); db=$(env_get PG_DB)
q() { docker exec -i proguzellik-prod-postgres psql -X -tA -v ON_ERROR_STOP=1 -U "${owner:-proguzellik_owner}" -d "${db:-proguzellik}" -c "$1"; }
wait_healthy() {
  for i in $(seq 1 36); do
    bad=0
    for c in "$@"; do
      h=$(docker inspect -f '{{.State.Health.Status}}' "proguzellik-prod-$c" 2>/dev/null || echo yok)
      [[ "$h" == healthy ]] || bad=1
    done
    (( bad == 0 )) && return 0
    sleep 5
  done
  return 1
}
api_get() { docker exec proguzellik-prod-api node -e "fetch('http://localhost:4000$1').then(async r=>console.log(r.status+' '+(await r.text()))).catch(()=>console.log('hata'))"; }

log "1/10 Ön kontrol (çalışan: $OLD → yeni: $NEW)"
grep -q "^APP_VERSION=$OLD$" .env || fail "Çalışan sürüm $OLD değil ($(env_get APP_VERSION))"
docker image inspect proguzellik-api:$NEW proguzellik-web:$NEW >/dev/null || fail "Yeni imajlar sunucuda yok"
[[ -f docker-compose.yml.$NEW && -f docker-compose.yml.$OLD ]] || fail "docker-compose.yml.$NEW / .$OLD bulunamadı"
cmp -s docker-compose.yml docker-compose.yml.$OLD || fail "Sunucudaki docker-compose.yml $OLD sürümünden farklı (elle değişiklik?); üzerine yazılmadı"
cmp -s docker-compose.yml.$OLD docker-compose.yml.$NEW || fail "Compose dosyası bu yayında değişmemeliydi"
DEMO=$(q "SELECT id FROM \"Tenant\" WHERE slug = 'demo-salon'")
[[ "$(q "SELECT \"districtCode\" FROM \"SalonListing\" WHERE \"tenantId\" = '$DEMO'")" == 60042 ]] || fail "Demo salon rehberde Karaman › Merkez değil"
echo "Serbest metin mahallesi olan salonlar (demo dışında; dokunulmaz): $(q "SELECT count(*) FROM \"Tenant\" WHERE neighborhood IS NOT NULL AND id <> '$DEMO'")"
[[ -n "$DEMO" ]] || fail "demo-salon işletmesi bulunamadı"
echo "Satın alma: $(env_get PURCHASE_ENABLED) · AI_MODE: $(env_get AI_MODE) · META_MODE: $(env_get META_MODE) · PAYMENT_MODE: $(env_get PAYMENT_MODE) (değiştirilmeyecek)"
echo "Demo salon: $DEMO"

log "2/10 Yedek + geri yükleme testi (geçici veritabanına)"
RESTORE_TEST_WEEKDAY=$(date +%u) ./backup.sh
grep -q " OK " /opt/proguzellik/backups/last-status || fail "Yedek başarısız"
cat /opt/proguzellik/backups/last-status
grep -qi "geri yükleme" /opt/proguzellik/backups/backup.log && tail -8 /opt/proguzellik/backups/backup.log | grep -iE "geri|restore|TAMAM" || true

log "3/10 Çalışan sürümün imajını arşivle"
./archive-image.sh "$OLD"

log "4/10 Ayar dosyalarını yedekle, compose dosyasını ve sürümü güncelle"
cp -p .env ".env.bak-$STAMP-$NEW"; chmod 600 ".env.bak-$STAMP-$NEW"
cp -p docker-compose.yml "docker-compose.yml.bak-$STAMP-$NEW"
cp docker-compose.yml.$NEW docker-compose.yml
sed -i "s/^APP_VERSION=.*/APP_VERSION=$NEW/" .env
chmod 600 .env
diff <(grep -v '^APP_VERSION=' ".env.bak-$STAMP-$NEW") <(grep -v '^APP_VERSION=' .env) >/dev/null || { undo; fail ".env'de APP_VERSION dışında fark oluştu; geri alındı"; }

log "5/10 Bekleyen veritabanı değişiklikleri (yalnızca 1 migration beklenir)"
status=$(docker compose run --rm migrate node dist/cli/migrate.js status 2>&1 || true)
echo "$status" | tail -4
pending=$(echo "$status" | { grep -oE '[0-9]{14}_[a-z0-9_]+' || true; } | sort -u | tr '\n' ' ')
[[ "$pending" == "$EXPECTED" ]] || { undo; fail "Bekleyen migration'lar beklenenden farklı ($pending); hiçbir şey değiştirilmedi (dosyalar eski hâline döndü)"; }

log "6/10 Ön denetim (preflight)"
./preflight.sh || { undo; fail "Ön denetim başarısız; hiçbir şey değiştirilmedi"; }

log "7/10 Migration uygula ve api/worker/web'i yeni sürümle başlat"
STARTED=1
docker compose run --rm migrate
docker compose up -d api worker web

log "8/10 Sağlık kontrolü (en fazla 3 dk)"
wait_healthy api worker web || fail "Konteynerler 3 dakikada sağlıklı olmadı"
docker compose ps --format '{{.Name}} {{.Image}} {{.Status}}'
for c in api worker web; do
  img=$(docker inspect -f '{{.Config.Image}}' "proguzellik-prod-$c")
  [[ "$img" == *":$NEW" ]] || fail "$c konteyneri $NEW imajında değil ($img)"
done
[[ "$(q "SELECT count(*) FROM \"SalonListing\" WHERE \"neighborhoodSlug\" IS NOT NULL")" == 0 ]] || fail "neighborhoodSlug boş başlamalıydı"
[[ "$(q "SELECT relrowsecurity FROM pg_class WHERE relname = 'SalonListing'")" == t ]] || fail "SalonListing RLS açık değil"
[[ "$(q "SELECT has_column_privilege('app_tenant', '\"SalonListing\"', 'neighborhoodSlug', 'UPDATE')")" == t ]] || fail "İşletme rolü mahalle seçimini yazamıyor"

log "9/10 Demo salon: Kirişçi Mahallesi listedeki Karaman › Merkez › Kirişçi ile eşleştirilir"
[[ "$(q "SELECT neighborhood FROM \"Tenant\" WHERE id = '$DEMO'")" == "Kirişçi Mahallesi" ]] || fail "Demo salonun mahallesi beklenen gibi değil"
n=$(q "WITH u AS (UPDATE \"SalonListing\" SET \"neighborhoodSlug\" = 'kirisci', \"updatedAt\" = now() WHERE \"tenantId\" = '$DEMO' AND \"districtCode\" = 60042 AND \"neighborhoodSlug\" IS NULL RETURNING 1) SELECT count(*) FROM u")
[[ "$n" == 1 ]] || fail "Demo salonun mahalle seçimi yazılamadı ($n satır)"
q "INSERT INTO \"AuditLog\" (id, \"tenantId\", action, entity, \"entityId\", metadata)
   VALUES (gen_random_uuid(), '$DEMO', 'salon.listing_updated', 'SalonListing', '$DEMO',
   '{\"source\":\"deploy-app-$NEW.sh\",\"neighborhoodSlug\":\"kirisci\",\"neighborhood\":\"Kirişçi Mahallesi\"}')" >/dev/null

log "10/10 Duman testleri"
for p in / /fiyatlar /salonlar /salonlar/karaman /salonlar/karaman/merkez "/salonlar/karaman/merkez?mahalle=kirisci" /r/demo-salon/uygulama /hesap-silme; do
  c=$(curl -s -o /dev/null -w '%{http_code}' "https://proguzellik.com$p" || echo hata)
  [[ "$c" == 200 ]] || fail "$p $c"
  echo "$p: 200"
done
c=$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' https://proguzellik.com/r/demo-salon || echo hata)
[[ "$c" == "307 https://proguzellik.com/r/demo-salon/uygulama" ]] || fail "/r/demo-salon beklenen yönlendirme değil: $c"
echo "/r/demo-salon: 307 → /r/demo-salon/uygulama (salon uygulaması açık; eski sürümle aynı)"
curl -s https://proguzellik.com/salonlar | grep -q 'noindex' || fail "/salonlar noindex değil"
curl -s https://proguzellik.com/salonlar/karaman/merkez | grep -q 'demo-salon' || fail "Demo salon Karaman › Merkez listesinde yok"
curl -s "https://proguzellik.com/salonlar/karaman/merkez?mahalle=kirisci" | grep -q 'demo-salon' || fail "Demo salon Kirişçi filtresinde yok"
c=$(curl -s -o /dev/null -w '%{http_code}' "https://proguzellik.com/salonlar/karaman/merkez?mahalle=yok-boyle")
[[ "$c" == 404 ]] || fail "Bilinmeyen mahalle 404 değil: $c"
echo "/salonlar noindex, demo salon Karaman › Merkez'de ve Kirişçi filtresinde görünüyor; bilinmeyen mahalle 404"
r=$(api_get "/public/directory/provinces/karaman/merkez")
[[ "$r" == *'"neighborhoods":[{"slug":"kirisci","name":"Kirişçi Mahallesi","count":1}]'* ]] || fail "Mahalle filtresi beklenen gibi değil: ${r:0:300}"
r=$(api_get /public/directory/provinces); echo "Rehber illeri: $r"
[[ "$r" == 200* && "$r" == *'"slug":"karaman"'* ]] || fail "Rehber API beklenen yanıtı vermedi"
r=$(api_get /public/salons/demo-salon)
[[ "$r" == 200* && "$r" == *'Kirişçi Mahallesi, Merkez / Karaman'* && "$r" == *'"directionsUrl":null'* ]] || fail "Demo salon sayfasında tam adres yok: ${r:0:300}"
echo "Demo salon sayfası tam adres: Kirişçi Mahallesi, Merkez / Karaman (yol tarifi kapalı)"
r=$(api_get /directory/listing); [[ "$r" == 401* ]] || fail "İşletme ayarı girişsiz açık: $r"; echo "İşletme rehber ayarı girişsiz: 401"
r=$(api_get /platform/directory); [[ "$r" == 401* ]] || fail "Platform rehberi girişsiz açık: $r"; echo "Platform rehberi girişsiz: 401"
echo "Uygulamadan fiyatlar: $(curl -s -o /dev/null -w '%{http_code} → %{redirect_url}' -A 'Mozilla/5.0 ProGuzellikApp/1.0.0' https://proguzellik.com/fiyatlar) (307 → /uygulamada-yok beklenir)"
echo "Instagram bağlama sayfası (girişsiz): $(curl -s -o /dev/null -w '%{http_code}' https://proguzellik.com/panel/kanallar/instagram-bagla) (307 → /giris beklenir)"
echo "META_IG_CONFIG_ID: $([[ -z "$(env_get META_IG_CONFIG_ID)" ]] && echo 'yok (düğme gizli)' || echo VAR) (değiştirilmedi)"
docker compose run --rm migrate node dist/cli/migrate.js status 2>&1 | tail -2
trap - ERR
log "TAMAM: $NEW çalışıyor (APP_VERSION=$(env_get APP_VERSION))."
echo "Geri dönüş: cd /opt/proguzellik/infra/production && cp -p docker-compose.yml.bak-$STAMP-$NEW docker-compose.yml && cp -p .env.bak-$STAMP-$NEW .env && ./rollback.sh $OLD"
echo "Bu çıktıyı Claude'a gönderin."
