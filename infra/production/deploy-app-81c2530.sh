#!/usr/bin/env bash
# Pro Güzellik: 56e592e → 81c2530 (api + worker + web) ve yapay zekâ yanıtını OpenAI ile AÇAR (AI_MODE=openai).
# İçerik: gelen WhatsApp/Instagram mesajlarına OpenAI (Responses API, store:false) ile yanıt. Migration YOK.
#         Yapay zekâ hiçbir salonda kendiliğinden açılmaz: her salon panelden kendi onayını verir (Akıllı paket, deneme/aktif).
#         Yapay zekâ ayarı açık salon sayısı yayından sonra 0 olmalıdır; yalnızca Deneme salonu elle açılır.
# Bu betik YALNIZCA Bektaş Tura'nın onayıyla ve onun terminalinde çalıştırılır (OpenAI anahtarı gizli olarak sorulur):
#   ssh -t prososyalmedya 'bash /opt/proguzellik/infra/production/deploy-app-81c2530.sh'
# Ne yapmaz: satın alma / iyzico / Meta / Caddy / DNS ayarlarına dokunmaz; sahip asistanı (Sorular) kural tabanlı kalır.
set -Eeuo pipefail
cd /opt/proguzellik/infra/production
OLD=56e592e NEW=81c2530
EXPECTED=""
OPENAI_MODEL_VAL=gpt-6.1-terra
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
grep -q 'AI_MODE: ${AI_MODE:-mock}' docker-compose.yml.$NEW || fail "Yeni compose dosyasında yapay zekâ varsayılanı mock değil"
[[ "$(env_get COMPOSE_FILE)" == *docker-compose.egress.yml* ]] || fail "Çıkış ağı (egress) kapalı: api OpenAI'a ulaşamaz"
[[ "$(env_get META_MODE)" == "live" ]] || fail "Meta bağlantısı canlı değil (META_MODE=$(env_get META_MODE))"
[[ "$(env_get AI_MODE)" != "openai" ]] || fail ".env'de AI_MODE zaten openai; beklenmeyen durum"
ai_on=$(q "SELECT count(*) FROM \"ChannelConnection\" WHERE \"aiAutoReply\" = true")
echo "Yapay zekâ yanıtı açık kanal sayısı (yayından önce): $ai_on (0 beklenir)"
[[ "$ai_on" == "0" ]] || fail "Bazı kanallarda yapay zekâ yanıtı zaten açık; Claude ile konuşun"
PURCHASE_BEFORE=$(env_get PURCHASE_ENABLED); echo "Siteden satın alma ayarı: ${PURCHASE_BEFORE:-0} (değiştirilmeyecek)"

log "2/9 OpenAI API anahtarı"
KEY=$(env_get OPENAI_API_KEY || true)
if [[ ! "$KEY" =~ ^[A-Za-z0-9_-]{20,}$ ]]; then
  echo "platform.openai.com → API keys → Create new secret key. Yapıştırın; ekranda görünmez:"
  read -rs -p "OpenAI API anahtarı: " KEY </dev/tty; echo
  KEY=$(printf '%s' "$KEY" | tr -d '[:space:]')
  [[ "$KEY" =~ ^[A-Za-z0-9_-]{20,}$ ]] || fail "Anahtar biçimi geçersiz; hiçbir şey değiştirilmedi"
fi
echo "Anahtar alındı (…${KEY: -4}); OpenAI'da doğrulanıyor"
code=$(printf 'header = "Authorization: Bearer %s"\n' "$KEY" | curl -s -o /dev/null -w '%{http_code}' --max-time 20 --config - "https://api.openai.com/v1/models/$OPENAI_MODEL_VAL" || echo hata)
[[ "$code" == "200" ]] || fail "OpenAI anahtarı/modeli doğrulanamadı (HTTP $code; 401=anahtar, 403/404=model erişimi). Hiçbir şey değiştirilmedi"
echo "OpenAI: anahtar geçerli, $OPENAI_MODEL_VAL erişilebilir"

log "3/9 Yedek + geri yükleme testi (geçici veritabanına)"
RESTORE_TEST_WEEKDAY=$(date +%u) ./backup.sh
grep -q " OK " /opt/proguzellik/backups/last-status || fail "Yedek başarısız"
cat /opt/proguzellik/backups/last-status

log "4/9 Çalışan sürümün imajını arşivle"
./archive-image.sh "$OLD"

log "5/9 Ayar dosyalarını yedekle, compose dosyasını, sürümü ve yapay zekâ ayarlarını güncelle"
cp -p .env ".env.bak-$STAMP-$NEW"; chmod 600 ".env.bak-$STAMP-$NEW"
cp -p docker-compose.yml "docker-compose.yml.bak-$STAMP-$NEW"
cp docker-compose.yml.$NEW docker-compose.yml
undo() { cp -p "docker-compose.yml.bak-$STAMP-$NEW" docker-compose.yml; cp -p ".env.bak-$STAMP-$NEW" .env; }
sed -i "s/^APP_VERSION=.*/APP_VERSION=$NEW/" .env
env_set OPENAI_API_KEY "$KEY"; unset KEY
env_set OPENAI_MODEL "$OPENAI_MODEL_VAL"
env_set AI_MODE openai
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
echo "Meta: $(docker exec proguzellik-prod-api printenv META_MODE) (live beklenir) · yapay zekâ açık kanal: $(q "SELECT count(*) FROM \"ChannelConnection\" WHERE \"aiAutoReply\" = true") (0 beklenir)"
st=$(docker exec proguzellik-prod-api node -e "fetch('http://localhost:4000/purchase/status').then(r=>r.text()).then(console.log).catch(()=>console.log('hata'))")
echo "Satın alma durumu: $st (yayından önceki gibi)"
echo "Ana sayfa: $(curl -s -o /dev/null -w '%{http_code}' https://proguzellik.com/) (200 beklenir)"
trap - ERR
log "TAMAM: $NEW çalışıyor, yapay zekâ yanıtı OpenAI ($OPENAI_MODEL_VAL) ile HAZIR; hiçbir salonda açık değil."
cat <<EOT

Sıradaki adım (panelden): Deneme salonu sahibi olarak Kanallar → WhatsApp → "Yapay zekâ yanıtı"nı açıp veri aktarımı onayını verin.
Geri dönüş: cp -p docker-compose.yml.bak-$STAMP-$NEW docker-compose.yml && cp -p .env.bak-$STAMP-$NEW .env && ./rollback.sh $OLD
Bu çıktıyı Claude'a gönderin.
EOT
