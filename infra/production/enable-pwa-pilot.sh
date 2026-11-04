#!/usr/bin/env bash
# Pro Güzellik: PWA V1.0'ı ortamda açılabilir yapar ve canlı Web Push'u etkinleştirir.
# Bu betik YALNIZCA Bektaş Tura'nın onayıyla çalıştırılır.
# Kullanım (sunucuda): bash /opt/proguzellik/infra/production/enable-pwa-pilot.sh
#
# Ne yapar: .env yedeği → VAPID anahtarı üretir (yoksa; özel anahtar ekrana yazılmaz) → PWA_ENABLED=1,
#           WEB_PUSH_MODE=live → ön denetim → api/worker'ı yeniden başlatır → push servisine çıkışı dener.
# Ne yapmaz: hiçbir işletmede bayrak açmaz (bunu SaaS sahibi panelden işletme başına yapar), push göndermez.
# Geri almak: .env'de PWA_ENABLED=0 ve WEB_PUSH_MODE=off → docker compose up -d --no-deps api worker
set -Eeuo pipefail
cd /opt/proguzellik/infra/production
STAMP=$(date +%Y%m%d-%H%M%S)
log() { printf '\n[%s] %s\n' "$(date '+%H:%M:%S')" "$*"; }
fail() { printf '\n*** DURDU: %s ***\nAyarları geri almak için: cp -p .env.bak-%s-pwa .env && docker compose up -d --no-deps api worker\n' "$*" "$STAMP" >&2; exit 1; }
trap 'fail "satır $LINENO başarısız oldu"' ERR
env_get() { grep -E "^$1=" .env | tail -1 | cut -d= -f2- ; }
env_set() { if grep -qE "^$1=" .env; then sed -i "s|^$1=.*|$1=$2|" .env; else printf '%s=%s\n' "$1" "$2" >> .env; fi; }

log "1/5 Ön kontrol"
V=$(env_get APP_VERSION)
[[ "$V" == 326e50f ]] || fail "Çalışan sürüm 326e50f değil ($V)"
[[ "$(env_get EMAIL_MODE)" == smtp ]] || fail "EMAIL_MODE=smtp değil: müşteri portalı giriş kodu gönderemez"
[[ "$(env_get COMPOSE_FILE)" == *docker-compose.egress.yml* ]] || fail "COMPOSE_FILE'da docker-compose.egress.yml yok"
cp -p .env ".env.bak-$STAMP-pwa"; chmod 600 ".env.bak-$STAMP-pwa"
echo ".env yedeği: .env.bak-$STAMP-pwa"

log "2/5 VAPID anahtarları"
if [[ -n "$(env_get VAPID_PUBLIC_KEY)" && -n "$(env_get VAPID_PRIVATE_KEY)" ]]; then
  echo "Mevcut anahtarlar korunuyor"
else
  keys=$(docker run --rm --network none --entrypoint node "proguzellik-api:$V" -e 'const k=require("web-push").generateVAPIDKeys();console.log(k.publicKey+" "+k.privateKey)')
  pub=${keys% *}; priv=${keys#* }
  [[ ${#pub} -ge 80 && ${#priv} -ge 40 ]] || fail "VAPID anahtarı üretilemedi"
  env_set VAPID_PUBLIC_KEY "$pub"; env_set VAPID_PRIVATE_KEY "$priv"
  unset keys priv
  echo "Yeni anahtar üretildi (özel anahtar yalnızca .env'de)"
fi
[[ -n "$(env_get VAPID_SUBJECT)" ]] || env_set VAPID_SUBJECT "mailto:info@proguzellik.com"
echo "VAPID_PUBLIC_KEY=$(env_get VAPID_PUBLIC_KEY)"
echo "VAPID_SUBJECT=$(env_get VAPID_SUBJECT)"

log "3/5 PWA ve canlı push açılıyor (işletme bayrakları kapalı kalır)"
env_set PWA_ENABLED 1
env_set WEB_PUSH_MODE live
chmod 600 .env
grep -E '^(PWA_ENABLED|WEB_PUSH_MODE)=' .env
./preflight.sh || fail "Ön denetim başarısız"

log "4/5 api ve worker yeniden başlatılıyor"
docker compose up -d --no-deps api worker
for i in $(seq 1 36); do
  a=$(docker inspect -f '{{.State.Health.Status}}' proguzellik-prod-api 2>/dev/null || echo yok)
  w=$(docker inspect -f '{{.State.Health.Status}}' proguzellik-prod-worker 2>/dev/null || echo yok)
  [[ "$a" == healthy && "$w" == healthy ]] && break
  sleep 5
done
docker compose ps --format '{{.Name}} {{.Image}} {{.Status}}'
[[ "$a" == healthy && "$w" == healthy ]] || fail "api/worker 3 dakikada sağlıklı olmadı"

log "5/5 Push servislerine çıkış denemesi (bildirim göndermez, yalnız bağlantı)"
docker exec proguzellik-prod-worker node -e '
const u=["https://fcm.googleapis.com/","https://web.push.apple.com/","https://updates.push.services.mozilla.com/"];
Promise.all(u.map(x=>fetch(x,{method:"HEAD",signal:AbortSignal.timeout(8000)}).then(r=>x+" -> "+r.status).catch(e=>x+" -> HATA "+(e.cause?.code||e.name)))).then(r=>console.log(r.join("\n")))'
trap - ERR
log "TAMAM: PWA_ENABLED=1, WEB_PUSH_MODE=live. Hiçbir işletmede bayrak açılmadı. Bu çıktıyı Claude'a gönderin."
