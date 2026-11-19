#!/usr/bin/env bash
# SALT OKUNUR: canlı iyzico ödemelerinin özeti (son N gün, varsayılan 14). Ad, e-posta, telefon, kart YAZDIRILMAZ.
#   bash check-payments.sh [gün]
set -Eeuo pipefail
cd /opt/proguzellik/infra/production
DAYS="${1:-14}"; [[ "$DAYS" =~ ^[0-9]+$ ]] || { echo "gün sayı olmalı"; exit 1; }
env_get() { { grep -E "^$1=" .env || true; } | tail -1 | cut -d= -f2- ; }
owner=$(env_get PG_OWNER_USER); db=$(env_get PG_DB)
psqlq() { docker exec -i proguzellik-prod-postgres psql -X -U "${owner:-proguzellik_owner}" -d "${db:-proguzellik}" -P pager=off -c "BEGIN READ ONLY; $1; COMMIT;" | grep -v -E '^(BEGIN|COMMIT)$'; }
ts() { local c="${1//\\/}"; echo "to_char($c AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Istanbul','DD.MM HH24:MI')"; }
W="> now() - interval '$DAYS days'"

echo "== iyzico ayarları (değerler gösterilmez)"
for k in PAYMENT_MODE IYZICO_BASE_URL IYZICO_PILOT_TENANTS PURCHASE_ENABLED; do printf '%-22s %s\n' "$k" "$(env_get $k)"; done
for k in IYZICO_API_KEY IYZICO_SECRET_KEY IYZICO_MERCHANT_ID IYZICO_CALLBACK_BASE; do v=$(env_get $k); printf '%-22s %s\n' "$k" "$([[ -n "$v" ]] && echo dolu || echo BOŞ)"; done
v=$(env_get IYZICO_API_KEY); [[ "$v" == sandbox-* ]] && echo "UYARI: API anahtarı sandbox-" || true

echo; echo "== Son $DAYS günde ödeme formları (IyzicoCheckout)"
psqlq "SELECT $(ts '"createdAt"') AS acildi, environment AS ortam, \"planCode\" AS paket, \"billingCycle\" AS donem, \"grossAmount\" AS tutar_kdv_dahil, status AS durum, (\"purchaseRequestId\" IS NOT NULL) AS siteden, left(coalesce(error,'-'),60) AS hata FROM \"IyzicoCheckout\" WHERE \"createdAt\" $W ORDER BY \"createdAt\" DESC LIMIT 30"

echo "== iyzico abonelikleri (tümü)"
psqlq "SELECT $(ts 's.\"createdAt\"') AS acildi, left(t.name,25) AS salon, s.\"planCode\" AS paket, s.\"billingCycle\" AS donem, s.status AS durum, s.\"cancelAtPeriodEnd\" AS donem_sonu_iptal, $(ts 's.\"currentPeriodEnd\"') AS donem_sonu, s.provider FROM \"Subscription\" s JOIN \"Tenant\" t ON t.id=s.\"tenantId\" WHERE s.provider LIKE 'iyzico%' ORDER BY s.\"createdAt\" DESC LIMIT 30"

echo "== Son $DAYS günde tahsilatlar (SubscriptionPayment)"
psqlq "SELECT $(ts 'p.\"createdAt\"') AS zaman, left(t.name,25) AS salon, p.amount AS tutar, p.\"netAmount\" AS kdv_haric, p.status AS durum, p.provider FROM \"SubscriptionPayment\" p JOIN \"Tenant\" t ON t.id=p.\"tenantId\" WHERE p.\"createdAt\" $W ORDER BY p.\"createdAt\" DESC LIMIT 30"

echo "== Son $DAYS günde iyzico bildirimleri (webhook)"
psqlq "SELECT $(ts '\"receivedAt\"') AS geldi, \"eventType\" AS olay, (\"processedAt\" IS NOT NULL) AS islendi, left(coalesce(result,'-'),50) AS sonuc FROM \"IyzicoWebhookEvent\" WHERE \"receivedAt\" $W ORDER BY \"receivedAt\" DESC LIMIT 30"

echo "== Son $DAYS günde ödeme denetim kayıtları (iyzico.*, purchase.*)"
psqlq "SELECT $(ts '\"createdAt\"') AS zaman, action AS islem, left(coalesce(metadata->>'error', metadata->>'reason', '-'),60) AS ayrinti FROM \"AuditLog\" WHERE (action LIKE 'iyzico.%' OR action LIKE 'purchase.%') AND \"createdAt\" $W ORDER BY \"createdAt\" DESC LIMIT 40"
