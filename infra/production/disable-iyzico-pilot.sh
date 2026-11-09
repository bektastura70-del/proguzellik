#!/usr/bin/env bash
# Pro Güzellik: iyzico ödemesini tüm salonlarda kapatır (.env'den PAYMENT_MODE/IYZICO_ satırlarını siler, api/worker'ı yeniden başlatır).
# Var olan abonelik kayıtları silinmez. Canlı iyzico abonelikleri iyzico tarafında sürer; durdurmak için salon panelinden iptal gerekir.
# Kullanım (sunucuda): bash /opt/proguzellik/infra/production/disable-iyzico-pilot.sh
set -Eeuo pipefail
cd /opt/proguzellik/infra/production
cp -p .env ".env.bak-$(date +%Y%m%d-%H%M%S)-iyzico-off"; chmod 600 .env.bak-*-iyzico-off
sed -i -E '/^(PAYMENT_MODE|IYZICO_[A-Z_]+)=/d' .env
docker compose up -d --no-deps api worker
sleep 20
echo "API PAYMENT_MODE: $(docker exec proguzellik-prod-api printenv PAYMENT_MODE) (mock beklenir = ödeme kapalı)"
