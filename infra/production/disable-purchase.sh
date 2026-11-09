#!/usr/bin/env bash
# Pro Güzellik: siteden doğrudan paket satın almayı KAPATIR (acil durum / geri alma). Onay sormaz.
# Açılmış salonlar ve abonelikleri etkilenmez; ödeme formu açık olan kişinin ödemesi tamamlanırsa hesabı yine açılır
# (dönüş ve günlük eşitleme bayraktan bağımsızdır), yeni satın alma isteği alınmaz.
# Kullanım (sunucuda): bash /opt/proguzellik/infra/production/disable-purchase.sh
set -Eeuo pipefail
cd /opt/proguzellik/infra/production
STAMP=$(date +%Y%m%d-%H%M%S)
cp -p .env ".env.bak-$STAMP-purchase-off"; chmod 600 ".env.bak-$STAMP-purchase-off"
sed -i '/^PURCHASE_ENABLED=/d' .env
docker compose up -d --no-deps api
for i in $(seq 1 24); do
  h=$(docker inspect -f '{{.State.Health.Status}}' proguzellik-prod-api 2>/dev/null || echo yok)
  [[ "$h" == healthy ]] && break
  sleep 5
done
st=$(docker exec proguzellik-prod-api node -e "fetch('http://localhost:4000/purchase/status').then(r=>r.text()).then(console.log).catch(()=>console.log('hata'))")
echo "API: $h · Satın alma durumu: $st ({\"enabled\":false} beklenir)"
