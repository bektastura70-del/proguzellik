#!/usr/bin/env bash
# Pro Güzellik: 61af0b4 → df86b71 (api + worker + web). Bektaş Tura'nın onayıyla.
# İçerik: online randevu bildirimi ve mükerrer müşteri düzeltmesi.
#  - Müşteri online/uygulama/WhatsApp-Instagram yapay zekâsıyla randevu alınca ya da iptal edince işletme sahibi, yönetici,
#    resepsiyon ve atanan personele e-posta + panel bildirimi (salon uygulaması pilotu ve WhatsApp'tan bağımsız).
#  - Online formda e-posta verilirse müşteriye onay + "randevuyu görüntüle / iptal et" bağlantısı.
#  - Telefon tek biçimde (0XXXXXXXXXX) saklanır; +90/0/boşluklu eski yazımlar aynı müşteri sayılır.
#  - Panelde WhatsApp bağlı değil uyarısı, bildirim rozeti; mükerrer kayıt raporu (dist/cli/customer-duplicates.js, salt okunur).
# Migration YOK. Compose değişmez. .env'de yalnız APP_VERSION değişir.
# Hazırlık (Mac'te, proje kökünde):
#   V=df86b71
#   docker build --platform linux/amd64 -f apps/api/Dockerfile -t proguzellik-api:$V .
#   docker build --platform linux/amd64 -f apps/web/Dockerfile -t proguzellik-web:$V .
#   docker save proguzellik-api:$V proguzellik-web:$V | gzip -1 | ssh prososyalmedya 'gunzip | docker load'
#   scp infra/production/docker-compose.yml prososyalmedya:/opt/proguzellik/infra/production/docker-compose.yml.$V
#   scp infra/production/deploy-app-$V.sh infra/production/check-online-bookings.sh prososyalmedya:/opt/proguzellik/infra/production/
# Kullanım: ssh -t prososyalmedya 'bash /opt/proguzellik/infra/production/deploy-app-df86b71.sh'
# Sağlık/duman testi başarısız olursa otomatik olarak $OLD'a döner.
set -Eeuo pipefail
cd /opt/proguzellik/infra/production
OLD=61af0b4 NEW=df86b71
EXPECTED=""
STAMP=$(date +%Y%m%d-%H%M%S)
STARTED=0 MIGRATING=0
env_get() { grep -E "^$1=" .env | tail -1 | cut -d= -f2- ; }
log() { printf '\n[%s] %s\n' "$(date '+%H:%M:%S')" "$*"; }
undo() { cp -p "docker-compose.yml.bak-$STAMP-$NEW" docker-compose.yml; cp -p ".env.bak-$STAMP-$NEW" .env; }
fail() {
  trap - ERR
  printf '\n*** DURDU: %s ***\n' "$*" >&2
  if (( MIGRATING == 1 )); then
    printf '\nMigration YARIDA kalmış olabilir. Uygulama eski sürüme döndürülüyor; veritabanına otomatik dokunulmaz. Claude ile inceleyin.\n' >&2
    printf 'Son yedek: %s\n' "$(cat /opt/proguzellik/backups/last-status 2>/dev/null)" >&2
  fi
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
tcmb() { docker exec "proguzellik-prod-$1" node -e "fetch('https://www.tcmb.gov.tr/kurlar/today.xml',{signal:AbortSignal.timeout(10000)}).then(async r=>{const t=await r.text();const m=/CurrencyCode=\"USD\"[\s\S]*?<ForexSelling>([^<]+)/.exec(t);console.log(r.status+' USD '+(m?m[1]:'yok'))}).catch(e=>console.log('hata '+e.name))"; }

log "1/10 Ön kontrol (çalışan: $OLD → yeni: $NEW)"
grep -q "^APP_VERSION=$OLD$" .env || fail "Çalışan sürüm $OLD değil ($(env_get APP_VERSION))"
docker image inspect proguzellik-api:$NEW proguzellik-web:$NEW >/dev/null || fail "Yeni imajlar sunucuda yok"
[[ -f docker-compose.yml.$NEW && -f docker-compose.yml.$OLD ]] || fail "docker-compose.yml.$NEW / .$OLD bulunamadı"
cmp -s docker-compose.yml docker-compose.yml.$OLD || fail "Sunucudaki docker-compose.yml $OLD sürümünden farklı (elle değişiklik?); üzerine yazılmadı"
cmp -s docker-compose.yml.$OLD docker-compose.yml.$NEW || fail "Compose dosyası bu yayında değişmemeliydi"
echo "AI_MODE: $(env_get AI_MODE) · AI_PILOT_TENANTS: $(env_get AI_PILOT_TENANTS) · AI_QUOTA_MODE: '$(env_get AI_QUOTA_MODE)' · AI_TOPUP_ENABLED: '$(env_get AI_TOPUP_ENABLED)' (değiştirilmeyecek)"

log "2/10 Yedek + geri yükleme testi (geçici veritabanına)"
bout="/opt/proguzellik/backups/deploy-$STAMP-$NEW.log"
RESTORE_TEST_WEEKDAY=$(date +%u) ./backup.sh 2>&1 | tee "$bout"
grep -q " OK " /opt/proguzellik/backups/last-status || fail "Yedek başarısız"
cat /opt/proguzellik/backups/last-status
grep -q "Doğrulama başarılı" "$bout" || fail "Geri yükleme testi başarılı görünmüyor ($bout); migration'a geçilmedi"

log "3/10 Çalışan sürümün imajını arşivle"
./archive-image.sh "$OLD"

log "4/10 Ayar dosyalarını yedekle, sürümü güncelle"
cp -p .env ".env.bak-$STAMP-$NEW"; chmod 600 ".env.bak-$STAMP-$NEW"
cp -p docker-compose.yml "docker-compose.yml.bak-$STAMP-$NEW"
sed -i "s/^APP_VERSION=.*/APP_VERSION=$NEW/" .env
chmod 600 .env
diff <(grep -v '^APP_VERSION=' ".env.bak-$STAMP-$NEW") <(grep -v '^APP_VERSION=' .env) >/dev/null || { undo; fail ".env'de APP_VERSION dışında fark oluştu; geri alındı"; }

log "5/10 Bekleyen veritabanı değişiklikleri (hiç beklenmez)"
status=$(docker compose run --rm migrate node dist/cli/migrate.js status 2>&1 || true)
echo "$status" | tail -4
pending=$(echo "$status" | { grep -oE '[0-9]{14}_[a-z0-9_]+' || true; } | sort -u | tr '\n' ' ')
[[ "$pending" == "$EXPECTED" ]] || { undo; fail "Bekleyen migration'lar beklenenden farklı ($pending); hiçbir şey değiştirilmedi"; }

log "6/10 Ön denetim (preflight)"
./preflight.sh || { undo; fail "Ön denetim başarısız; hiçbir şey değiştirilmedi"; }

log "7/10 Migration yok"
STARTED=1

log "8/10 api/worker/web'i yeni sürümle başlat"
docker compose up -d api worker web

log "9/10 Sağlık kontrolü (en fazla 3 dk)"
wait_healthy api worker web || fail "Konteynerler 3 dakikada sağlıklı olmadı"
docker compose ps --format '{{.Name}} {{.Image}} {{.Status}}'
for c in api worker web; do
  img=$(docker inspect -f '{{.Config.Image}}' "proguzellik-prod-$c")
  [[ "$img" == *":$NEW" ]] || fail "$c konteyneri $NEW imajında değil ($img)"
done
echo "api AI_TOPUP_ENABLED=$(docker exec proguzellik-prod-api printenv AI_TOPUP_ENABLED) AI_QUOTA_MODE=$(docker exec proguzellik-prod-api printenv AI_QUOTA_MODE) (değişmedi)"

log "10/10 Duman testleri"
for p in / /fiyatlar /kvkk /salonlar /hesap-silme; do
  c=$(curl -s -o /dev/null -w '%{http_code}' "https://proguzellik.com$p" || echo hata)
  [[ "$c" == 200 ]] || fail "$p $c"
  echo "$p: 200"
done
for p in /ai-quota /platform/ai; do
  r=$(api_get "$p"); [[ "$r" == 401* ]] || fail "$p girişsiz açık: ${r:0:200}"; echo "$p girişsiz: 401"
done
for p in /satin-al/odeme /panel/abonelik/odeme /panel/abonelik/ai-paket; do
  h=$(curl -sI "https://proguzellik.com$p" | grep -i '^content-security-policy' || true)
  [[ "$h" == *"form-action 'self' https://*.iyzipay.com https://*.iyzico.com https:"* && "$h" == *"frame-src https://*.iyzipay.com https://*.iyzico.com https:"* ]] || fail "$p 3D Secure güvenlik başlığı beklenen gibi değil"
  echo "$p: 3D Secure başlığı tamam"
done
r=$(api_get "/pwa/alert-channels"); [[ "$r" == 401* ]] || fail "/pwa/alert-channels girişsiz açık: ${r:0:200}"; echo "/pwa/alert-channels girişsiz: 401"
r=$(api_get "/public/salons/demo-salon/bookings/00000000-0000-4000-8000-000000000000?token=gecersiz-belirtec"); [[ "$r" == 403* || "$r" == 404* ]] || fail "randevu görüntüleme belirteçsiz açık: ${r:0:200}"; echo "randevu görüntüleme yanlış belirteçle: ${r:0:3}"
docker exec proguzellik-prod-api test -f dist/cli/customer-duplicates.js || fail "mükerrer kayıt raporu imajda yok"
h=$(curl -sI https://proguzellik.com/panel | grep -i '^content-security-policy' || true)
[[ "$h" != *"form-action 'self' https:"* && "$h" != *" https:;"* ]] || fail "/panel güvenlik başlığı gevşemiş"
echo "/panel: sıkı başlık aynen"
trap - ERR
log "TAMAM: $NEW çalışıyor (APP_VERSION=$(env_get APP_VERSION))."
echo "Salt okunur kontrol: bash check-online-bookings.sh 3   ·   mükerrer rapor: docker exec proguzellik-prod-api node dist/cli/customer-duplicates.js"
echo "Geri dönüş: cd /opt/proguzellik/infra/production && cp -p docker-compose.yml.bak-$STAMP-$NEW docker-compose.yml && cp -p .env.bak-$STAMP-$NEW .env && ./rollback.sh $OLD"
echo "Bu çıktıyı Claude'a gönderin."
