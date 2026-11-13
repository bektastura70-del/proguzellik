#!/usr/bin/env bash
# Android uygulama bağlantıları: https://proguzellik.com/.well-known/assetlinks.json yayına alınır, böylece
# proguzellik.com/r/... bağlantıları Pro Güzellik uygulamasında açılır. Yalnızca web konteyneri yeniden başlar.
# Değer: Play Console > Google Play ile korunanlar > Play uygulama imzalamayı yönet > Uygulama imzalama anahtarı SHA-256
# (gizli değildir). Yükleme anahtarının değeri DEĞİL.
#   ssh -t prososyalmedya 'bash /opt/proguzellik/infra/production/set-android-assetlinks.sh'
# Geri alma: betiğin sonunda yazılan komut (eski .env geri gelir, web yeniden başlar).
set -Eeuo pipefail
cd /opt/proguzellik/infra/production
FP="8A:85:06:65:99:12:70:5D:26:02:EB:0A:77:5C:CF:9E:6B:BE:A9:54:DA:6B:DE:21:3C:11:A3:50:7B:13:1D:37"
STAMP=$(date +%Y%m%d-%H%M%S)
env_get() { grep -E "^$1=" .env | tail -1 | cut -d= -f2- ; }
env_set() { if grep -qE "^$1=" .env; then sed -i "s|^$1=.*|$1=$2|" .env; else printf '%s=%s\n' "$1" "$2" >> .env; fi; }
trap 'echo "*** DURDU (satır $LINENO). Geri almak için: cp -p .env.bak-$STAMP-assetlinks .env && docker compose up -d web"' ERR
grep -q 'ANDROID_CERT_SHA256: ${ANDROID_CERT_SHA256:-}' docker-compose.yml || { echo "Compose dosyası beklenen sürüm değil"; exit 1; }
echo "Önce: $(curl -s -o /dev/null -w '%{http_code}' https://proguzellik.com/.well-known/assetlinks.json) (404 beklenir)"
cp -p .env ".env.bak-$STAMP-assetlinks"; chmod 600 ".env.bak-$STAMP-assetlinks"
[[ -z "$(tail -c1 .env)" ]] || echo >> .env
env_set ANDROID_CERT_SHA256 "$FP"; chmod 600 .env
docker compose up -d web
for i in $(seq 1 36); do [[ "$(docker inspect -f '{{.State.Health.Status}}' proguzellik-prod-web)" == healthy ]] && break; sleep 5; done
[[ "$(docker inspect -f '{{.State.Health.Status}}' proguzellik-prod-web)" == healthy ]] || false
echo "Ana sayfa: $(curl -s -o /dev/null -w '%{http_code}' https://proguzellik.com/) (200 beklenir)"
echo "assetlinks.json: $(curl -s https://proguzellik.com/.well-known/assetlinks.json)"
curl -s https://proguzellik.com/.well-known/assetlinks.json | grep -q "$FP" || false
trap - ERR
echo "TAMAM. Geri almak için: cp -p .env.bak-$STAMP-assetlinks .env && docker compose up -d web"
