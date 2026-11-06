#!/usr/bin/env bash
# Pro Güzellik: yenilenme hatırlatmasını ortamda açılabilir yapar (RENEWAL_REMINDERS=1).
# Bu betik YALNIZCA Bektaş Tura'nın onayıyla çalıştırılır. Kullanım (sunucuda): bash /opt/proguzellik/infra/production/enable-renewal-pilot.sh
#
# Bu adımdan sonra da HİÇBİR salona ileti gitmez: her salon için SaaS sahibi panelinden ayrıca izin (gerekçeli, denetim kaydıyla)
# ve o salonun Ayarlar sayfasından ayrıca açma gerekir. Pilot: yalnızca Deneme salonu.
# Geri almak: .env'den RENEWAL_REMINDERS satırını silip `docker compose up -d --no-deps api worker` (tüm salonlarda anında durur).
set -Eeuo pipefail
cd /opt/proguzellik/infra/production
STAMP=$(date +%Y%m%d-%H%M%S)
env_get() { grep -E "^$1=" .env | tail -1 | cut -d= -f2- ; }
log() { printf '\n[%s] %s\n' "$(date '+%H:%M:%S')" "$*"; }
fail() { printf '\n*** DURDU: %s ***\nAyarı geri almak için: cp -p .env.bak-%s-renewal .env && docker compose up -d --no-deps api worker\n' "$*" "$STAMP" >&2; exit 1; }
trap 'fail "satır $LINENO başarısız oldu"' ERR
owner=$(env_get PG_OWNER_USER); db=$(env_get PG_DB)
q() { docker exec -i proguzellik-prod-postgres psql -X -tA -U "${owner:-proguzellik_owner}" -d "${db:-proguzellik}" -c "$1"; }

log "1/4 Ön kontrol"
grep -q 'RENEWAL_REMINDERS: ${RENEWAL_REMINDERS:-0}' docker-compose.yml || fail "Compose dosyası bu özelliği tanımıyor (deploy-renewal.sh çalıştırıldı mı?)"
[[ "$(env_get EMAIL_MODE)" == smtp ]] || fail "EMAIL_MODE=smtp değil: hatırlatma e-postası gönderilemez"
allowed=$(q 'SELECT count(*) FROM "Tenant" WHERE "renewalRemindersAllowed"')
[[ "$allowed" == 0 ]] || fail "$allowed salonda izin zaten var; pilot öncesi hiçbir salonda izin olmamalı"

log "2/4 .env yedeği ve bayrak"
cp -p .env ".env.bak-$STAMP-renewal"; chmod 600 ".env.bak-$STAMP-renewal"
sed -i '/^RENEWAL_REMINDERS=/d' .env
echo "RENEWAL_REMINDERS=1" >> .env
grep -E '^RENEWAL_REMINDERS=' .env
./preflight.sh || fail "Ön denetim başarısız"

log "3/4 api ve worker yeniden başlatılıyor"
docker compose up -d --no-deps api worker
for i in $(seq 1 36); do
  a=$(docker inspect -f '{{.State.Health.Status}}' proguzellik-prod-api 2>/dev/null || echo yok)
  w=$(docker inspect -f '{{.State.Health.Status}}' proguzellik-prod-worker 2>/dev/null || echo yok)
  [[ "$a" == healthy && "$w" == healthy ]] && break
  sleep 5
done
docker compose ps --format '{{.Name}} {{.Image}} {{.Status}}'
[[ "$a" == healthy && "$w" == healthy ]] || fail "api/worker 3 dakikada sağlıklı olmadı"

log "4/4 Doğrulama"
echo "Worker RENEWAL_REMINDERS: $(docker exec proguzellik-prod-worker printenv RENEWAL_REMINDERS) (1 beklenir)"
echo "İzinli salon sayısı: $(q 'SELECT count(*) FROM "Tenant" WHERE "renewalRemindersAllowed"') (0 beklenir)"
trap - ERR
log "TAMAM: ortam açık, hiçbir salonda izin yok. Şimdi SaaS panelinden yalnızca Deneme salonuna izin verin. Bu çıktıyı Claude'a gönderin."
