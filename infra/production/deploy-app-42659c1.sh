#!/usr/bin/env bash
# Pro Güzellik: 5916f65 → 42659c1 (api + worker + web). Yapay zekâ randevu düzeltmesi. Migration YOK.
# İçerik: personele devir bildirimi düzeltmesi: rozet "personel yanıtı yok"a bağlı (konuşma açık olsa da kalır), yeni devirde
#         sayfada uyarı + ses + (izinliyse) masaüstü bildirimi. Önceki sürümün randevu düzeltmesi aynen duruyor.
#         Yapay zekâ randevu araçları kimliksiz çalışır (hizmet adı + tarih + saat); model önceki araç sonuçlarını göremediği için
#         randevuyu oluşturamıyordu. Ayrıca randevu oluşmadan "oluşturuldu" denirse yanıt değişir ve konuşma personele devredilir.
#         AI_MODE / OpenAI anahtarı / model ayarlarına dokunulmaz; kanal başına yapay zekâ ayarı olduğu gibi kalır.
# Bu betik YALNIZCA Bektaş Tura'nın onayıyla çalıştırılır:
#   ssh -t prososyalmedya 'bash /opt/proguzellik/infra/production/deploy-app-42659c1.sh'
# Ne yapmaz: anahtar sormaz, satın alma / iyzico / Meta / Caddy / DNS ayarlarına dokunmaz.
set -Eeuo pipefail
cd /opt/proguzellik/infra/production
OLD=5916f65 NEW=42659c1
EXPECTED=""
STAMP=$(date +%Y%m%d-%H%M%S)
env_get() { grep -E "^$1=" .env | tail -1 | cut -d= -f2- ; }
env_set() { if grep -qE "^$1=" .env; then sed -i "s|^$1=.*|$1=$2|" .env; else printf '%s=%s\n' "$1" "$2" >> .env; fi; }
log() { printf '\n[%s] %s\n' "$(date '+%H:%M:%S')" "$*"; }
fail() { printf '\n*** DURDU: %s ***\n' "$*" >&2; printf 'Geri almak için (yalnızca Claude ile konuştuktan sonra): cd /opt/proguzellik/infra/production && cp -p docker-compose.yml.bak-%s-%s docker-compose.yml 2>/dev/null; cp -p .env.bak-%s-%s .env 2>/dev/null; ./rollback.sh %s\n' "$STAMP" "$NEW" "$STAMP" "$NEW" "$OLD" >&2; exit 1; }
trap 'fail "satır $LINENO başarısız oldu"' ERR
owner=$(env_get PG_OWNER_USER); db=$(env_get PG_DB)
q() { docker exec -i proguzellik-prod-postgres psql -X -tA -U "${owner:-proguzellik_owner}" -d "${db:-proguzellik}" -c "$1"; }

log "1/9 Ön kontrol (çalışan: $OLD → yeni: $NEW)"
grep -q "^APP_VERSION=$OLD$" .env || fail "Çalışan sürüm $OLD değil ($(env_get APP_VERSION))"
docker image inspect proguzellik-api:$NEW proguzellik-web:$NEW >/dev/null || fail "Yeni imajlar sunucuda yok"
[[ -f docker-compose.yml.$NEW && -f docker-compose.yml.$OLD ]] || fail "docker-compose.yml.$NEW / .$OLD bulunamadı"
cmp -s docker-compose.yml docker-compose.yml.$OLD || fail "Sunucudaki docker-compose.yml $OLD sürümünden farklı (elle değişiklik?); üzerine yazılmadı"
grep -q 'AI_MODE: ${AI_MODE:-mock}' docker-compose.yml.$NEW || fail "Yeni compose dosyasında yapay zekâ ayarı beklenen biçimde değil"
[[ "$(env_get AI_MODE)" == "openai" ]] || fail "AI_MODE openai değil ($(env_get AI_MODE))"
[[ "$(env_get OPENAI_API_KEY)" =~ ^[A-Za-z0-9_-]{20,}$ && -n "$(env_get OPENAI_MODEL)" ]] || fail "OpenAI anahtarı/modeli .env'de yok"
echo "Yapay zekâ açık kanal sayısı (bilgi): $(q "SELECT count(*) FROM \"ChannelConnection\" WHERE \"aiAutoReply\" = true")"
PURCHASE_BEFORE=$(env_get PURCHASE_ENABLED); echo "Siteden satın alma ayarı: ${PURCHASE_BEFORE:-0} (değiştirilmeyecek)"

log "2/9 Ayarlar (anahtar sorulmaz; mevcut OpenAI ayarları korunur)"
echo "AI_MODE=$(env_get AI_MODE) · model: $(env_get OPENAI_MODEL)"

log "3/9 Yedek + geri yükleme testi (geçici veritabanına)"
RESTORE_TEST_WEEKDAY=$(date +%u) ./backup.sh
grep -q " OK " /opt/proguzellik/backups/last-status || fail "Yedek başarısız"
cat /opt/proguzellik/backups/last-status

log "4/9 Çalışan sürümün imajını arşivle"
./archive-image.sh "$OLD"

log "5/9 Ayar dosyalarını yedekle, compose dosyasını, ve sürümü güncelle"
cp -p .env ".env.bak-$STAMP-$NEW"; chmod 600 ".env.bak-$STAMP-$NEW"
cp -p docker-compose.yml "docker-compose.yml.bak-$STAMP-$NEW"
cp docker-compose.yml.$NEW docker-compose.yml
undo() { cp -p "docker-compose.yml.bak-$STAMP-$NEW" docker-compose.yml; cp -p ".env.bak-$STAMP-$NEW" .env; }
sed -i "s/^APP_VERSION=.*/APP_VERSION=$NEW/" .env
chmod 600 .env

log "6/9 Bekleyen veritabanı değişiklikleri (hiçbiri beklenmez)"
status=$(docker compose run --rm migrate node dist/cli/migrate.js status 2>&1 || true)
echo "$status" | tail -4
pending=$(echo "$status" | { grep -oE '[0-9]{14}_[a-z0-9_]+' || true; } | sort -u | tr '\n' ' ')
[[ "$pending" == "$EXPECTED" ]] || { undo; fail "Bekleyen migration'lar beklenenden farklı ($pending); hiçbir şey değiştirilmedi (dosyalar eski hâline döndü)"; }

log "7/9 Ön denetim (preflight)"
./preflight.sh || { undo; fail "Ön denetim başarısız; hiçbir şey değiştirilmedi"; }

log "8/9 Migration uygula ve api/worker/web'i yeni sürümle başlat"
docker compose run --rm migrate
docker compose up -d api worker web

log "9/9 Sağlık kontrolü (en fazla 3 dk)"
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
echo "API AI_MODE: $(docker exec proguzellik-prod-api printenv AI_MODE) (openai beklenir) · model: $(docker exec proguzellik-prod-api printenv OPENAI_MODEL)"
g=$(docker exec proguzellik-prod-api node -e "fetch('https://api.openai.com/v1/models').then(r=>console.log(r.status)).catch(e=>console.log('hata '+e.cause?.code))")
echo "API'den OpenAI'a erişim: $g (401 beklenir: anahtarsız istek reddedilir ama ağ çalışıyor)"
echo "Meta: $(docker exec proguzellik-prod-api printenv META_MODE) (live beklenir) · yapay zekâ açık kanal: $(q "SELECT count(*) FROM \"ChannelConnection\" WHERE \"aiAutoReply\" = true") (bilgi)"
st=$(docker exec proguzellik-prod-api node -e "fetch('http://localhost:4000/purchase/status').then(r=>r.text()).then(console.log).catch(()=>console.log('hata'))")
echo "Satın alma durumu: $st (yayından önceki gibi)"
echo "Ana sayfa: $(curl -s -o /dev/null -w '%{http_code}' https://proguzellik.com/) (200 beklenir)"
trap - ERR
log "TAMAM: $NEW çalışıyor, yapay zekâ randevu düzeltmesi yayında."
cat <<EOT

Sıradaki adım: Deneme salonunda WhatsApp'tan yeni bir randevu konuşması deneyin. Konuşma personele devredilmişse Mesajlar sayfasında "Yapay zekâya bırak" düğmesine basın.
Geri dönüş: cp -p docker-compose.yml.bak-$STAMP-$NEW docker-compose.yml && cp -p .env.bak-$STAMP-$NEW .env && ./rollback.sh $OLD
Bu çıktıyı Claude'a gönderin.
EOT
