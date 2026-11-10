#!/usr/bin/env bash
# Pro Güzellik: b69491e → 56e592e (api + worker + web) ve Meta bağlantısını AÇAR (META_MODE=live).
# İçerik: "WhatsApp'ı bağla" (ProGüzellik Meta uygulaması, Embedded Signup), ortak webhook /api/webhooks/meta,
#         Instagram numara eşleştirme düzeltmesi. 1 migration: 20261110130000_meta_embedded_signup
#         (ChannelConnection.managed varsayılan false + pinEnc boş; mevcut veri değişmez).
# Bu betik YALNIZCA Bektaş Tura'nın onayıyla ve onun terminalinde çalıştırılır (Meta App Secret gizli olarak sorulur):
#   ssh -t prososyalmedya 'bash /opt/proguzellik/infra/production/deploy-app-56e592e.sh'
# Ne yapmaz: yapay zekâ yanıtını açmaz (AI_MODE mock kalır, gelen mesajlar personel gelen kutusuna düşer),
#            satın alma / iyzico / Caddy / DNS ayarlarına dokunmaz.
set -Eeuo pipefail
cd /opt/proguzellik/infra/production
OLD=b69491e NEW=56e592e
EXPECTED="20261110130000_meta_embedded_signup "
META_APP_ID_VAL=2059349714909229 META_ES_CONFIG_ID_VAL=2374458413319534
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
grep -q 'META_MODE: ${META_MODE:-mock}' docker-compose.yml.$NEW || fail "Yeni compose dosyasında Meta varsayılanı mock değil"
[[ "$(env_get COMPOSE_FILE)" == *docker-compose.egress.yml* ]] || fail "Çıkış ağı (egress) kapalı: api Meta'ya ulaşamaz"
[[ "$(env_get META_MODE)" != "live" ]] || fail ".env'de META_MODE zaten live; beklenmeyen durum"
connected=$(q "SELECT count(*) FROM \"ChannelConnection\" WHERE status='CONNECTED'")
echo "Bağlı kanal sayısı (Meta açılmadan önce): $connected (0 beklenir)"
[[ "$connected" == "0" ]] || fail "Canlıda bağlı kanal var; Meta açılınca bunlar gerçek mesaj alıp gönderir. Önce Claude ile konuşun."
PURCHASE_BEFORE=$(env_get PURCHASE_ENABLED); echo "Siteden satın alma ayarı: ${PURCHASE_BEFORE:-0} (değiştirilmeyecek)"

log "2/9 Meta uygulama sırrı (App Secret)"
SECRET=$(env_get META_APP_SECRET || true)
if [[ ! "$SECRET" =~ ^[0-9a-fA-F]{32}$ ]]; then
  echo "developers.facebook.com → ProGüzellik → App settings → Temel → App secret (Göster). Yapıştırın; ekranda görünmez:"
  read -rs -p "Meta App Secret: " SECRET </dev/tty; echo
  SECRET=$(printf '%s' "$SECRET" | tr -d '[:space:]')
  [[ "$SECRET" =~ ^[0-9a-fA-F]{32}$ ]] || fail "App Secret 32 haneli onaltılık değil; hiçbir şey değiştirilmedi"
fi
echo "App Secret alındı (…${SECRET: -4})"

log "3/9 Yedek + geri yükleme testi (geçici veritabanına)"
RESTORE_TEST_WEEKDAY=$(date +%u) ./backup.sh
grep -q " OK " /opt/proguzellik/backups/last-status || fail "Yedek başarısız"
cat /opt/proguzellik/backups/last-status

log "4/9 Çalışan sürümün imajını arşivle"
./archive-image.sh "$OLD"

log "5/9 Ayar dosyalarını yedekle, compose dosyasını, sürümü ve Meta ayarlarını güncelle"
cp -p .env ".env.bak-$STAMP-$NEW"; chmod 600 ".env.bak-$STAMP-$NEW"
cp -p docker-compose.yml "docker-compose.yml.bak-$STAMP-$NEW"
cp docker-compose.yml.$NEW docker-compose.yml
undo() { cp -p "docker-compose.yml.bak-$STAMP-$NEW" docker-compose.yml; cp -p ".env.bak-$STAMP-$NEW" .env; }
sed -i "s/^APP_VERSION=.*/APP_VERSION=$NEW/" .env
env_set META_APP_ID "$META_APP_ID_VAL"
env_set META_ES_CONFIG_ID "$META_ES_CONFIG_ID_VAL"
env_set META_APP_SECRET "$SECRET"; unset SECRET
VERIFY=$(env_get META_WEBHOOK_VERIFY_TOKEN || true)
[[ ${#VERIFY} -ge 16 ]] || { VERIFY=$(openssl rand -hex 24); env_set META_WEBHOOK_VERIFY_TOKEN "$VERIFY"; }
env_set META_MODE live
chmod 600 .env

log "6/9 Bekleyen veritabanı değişiklikleri (yalnızca 1 migration beklenir)"
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
echo "API META_MODE: $(docker exec proguzellik-prod-api printenv META_MODE) (live beklenir) · Graph sürümü: $(docker exec proguzellik-prod-api printenv META_GRAPH_VERSION)"
g=$(docker exec proguzellik-prod-api node -e "fetch('https://graph.facebook.com/').then(r=>console.log(r.status)).catch(e=>console.log('hata '+e.cause?.code))")
echo "API'den Meta'ya erişim: $g (hata değil, bir HTTP kodu beklenir)"
ch=$(curl -s "https://proguzellik.com/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=$VERIFY&hub.challenge=pg$STAMP" || echo hata)
echo "Ortak webhook doğrulaması: $ch (pg$STAMP beklenir)"
st=$(docker exec proguzellik-prod-api node -e "fetch('http://localhost:4000/purchase/status').then(r=>r.text()).then(console.log).catch(()=>console.log('hata'))")
echo "Satın alma durumu: $st (yayından önceki gibi)"
echo "Kanallar sayfası: $(curl -s -o /dev/null -w '%{http_code}' https://proguzellik.com/panel/kanallar/whatsapp-bagla) (girişsiz 307 beklenir)"
trap - ERR
log "TAMAM: $NEW çalışıyor, Meta bağlantısı AÇIK (yapay zekâ yanıtı kapalı)."
cat <<EOT

Meta panelinde (ProGüzellik → WhatsApp → Configuration → Webhook) şu iki değeri SİZ girin:
  Callback URL : https://proguzellik.com/api/webhooks/meta
  Verify token : $VERIFY
Sonra "messages" alanına abone olun.

Geri dönüş: cp -p docker-compose.yml.bak-$STAMP-$NEW docker-compose.yml && cp -p .env.bak-$STAMP-$NEW .env && ./rollback.sh $OLD
Bu çıktıyı (doğrulama anahtarı satırı hariç) Claude'a gönderin.
EOT
