#!/usr/bin/env bash
# Pro Güzellik: sitede deneme BAŞVURU formunu açar (TRIAL_APPLICATIONS_ENABLED=1). Kendi kendine kayıt kapalı kalır.
# Yalnızca Bektaş Tura'nın onayıyla çalıştırılır. Kullanım (sunucuda): bash /opt/proguzellik/infra/production/enable-trial-applications.sh
# Kapatmak için: .env'den TRIAL_APPLICATIONS_ENABLED satırını silip `docker compose up -d --no-deps api`.
set -Eeuo pipefail
cd /opt/proguzellik/infra/production
STAMP=$(date +%Y%m%d-%H%M%S)
log() { printf '\n[%s] %s\n' "$(date '+%H:%M:%S')" "$*"; }
restore() { cp -p ".env.bak-$STAMP-trialapps" .env; printf '\n*** DURDU: %s — .env eski hâline döndü, API yeniden başlatılmadı ***\n' "$1" >&2; exit 1; }

log "1/4 Ön kontrol"
grep -qE '^REGISTRATION_ENABLED=1' .env && { echo "REGISTRATION_ENABLED=1: kayıt açıkken başvuru formu zaten kullanılmaz; durdu"; exit 1; }
grep -qE '^EMAIL_MODE=smtp' .env || { echo "EMAIL_MODE=smtp değil: başvurular doğrulanamaz; durdu"; exit 1; }
grep -q 'TRIAL_APPLICATIONS_ENABLED: ${TRIAL_APPLICATIONS_ENABLED:-0}' docker-compose.yml || { echo "Compose dosyası bu özelliği tanımıyor (7b88af4 dağıtımı yapıldı mı?)"; exit 1; }

log "2/4 .env yedeği ve bayrak"
cp -p .env ".env.bak-$STAMP-trialapps"
sed -i '/^TRIAL_APPLICATIONS_ENABLED=/d' .env
echo "TRIAL_APPLICATIONS_ENABLED=1" >> .env
grep -E '^TRIAL_APPLICATIONS_ENABLED=' .env

log "3/4 Ön denetim (preflight)"
./preflight.sh || restore "preflight başarısız"

log "4/4 Yalnızca API'yi yeniden başlat ve sağlık kontrolü"
docker compose up -d --no-deps api
for i in $(seq 1 24); do
  h=$(docker inspect -f '{{.State.Health.Status}}' proguzellik-prod-api 2>/dev/null || echo yok)
  [[ "$h" == healthy ]] && break
  sleep 5
done
[[ "$h" == healthy ]] || { echo "API 2 dakikada sağlıklı olmadı: docker compose logs --tail 50 api"; exit 1; }
reg=$(docker exec proguzellik-prod-api node -e "fetch('http://localhost:4000/auth/registration').then(r=>r.text()).then(console.log).catch(()=>console.log('hata'))")
echo "Kayıt durumu: $reg ({\"enabled\":false,\"applications\":true} beklenir)"
log "TAMAM: deneme başvuru formu AÇIK. Bu çıktıyı Claude'a gönderin."
