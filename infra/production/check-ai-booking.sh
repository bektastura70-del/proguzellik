#!/usr/bin/env bash
# SALT OKUNUR tanı: son 3 saatte yapay zekâ konuşmaları ve randevular. Mesaj metni, ad ve telefon YAZDIRILMAZ.
set -Eeuo pipefail
cd /opt/proguzellik/infra/production
env_get() { grep -E "^$1=" .env | tail -1 | cut -d= -f2- ; }
owner=$(env_get PG_OWNER_USER); db=$(env_get PG_DB)
psqlq() { docker exec -i proguzellik-prod-postgres psql -X -U "${owner:-proguzellik_owner}" -d "${db:-proguzellik}" -P pager=off -c "$1"; }
echo "== Son 3 saatte oluşan randevular"
psqlq "SELECT a.status, a.source, to_char(a.\"startsAt\" AT TIME ZONE 'Europe/Istanbul','DD.MM HH24:MI') AS baslangic_tr, to_char(a.\"createdAt\" AT TIME ZONE 'Europe/Istanbul','HH24:MI:SS') AS olusma, left(t.name,25) AS salon FROM \"Appointment\" a JOIN \"Tenant\" t ON t.id=a.\"tenantId\" WHERE a.\"createdAt\" > now() - interval '3 hours' ORDER BY a.\"createdAt\""
echo "== Yapay zekâ randevu kayıtları (denetim günlüğü)"
psqlq "SELECT action, to_char(\"createdAt\" AT TIME ZONE 'Europe/Istanbul','HH24:MI:SS') AS zaman FROM \"AuditLog\" WHERE action = 'booking.chat_created' AND \"createdAt\" > now() - interval '3 hours' ORDER BY \"createdAt\""
echo "== Konuşma durumu"
psqlq "SELECT mode, left(coalesce(\"handoffReason\",'-'),80) AS devir_nedeni, (state IS NOT NULL) AS bekleyen_randevu_var, to_char(\"lastMessageAt\" AT TIME ZONE 'Europe/Istanbul','HH24:MI:SS') AS son_mesaj FROM \"Conversation\" WHERE \"lastMessageAt\" > now() - interval '3 hours' ORDER BY \"lastMessageAt\""
echo "== Mesajlar (yön, yazan, durum, hata; metin yok)"
psqlq "SELECT to_char(\"createdAt\" AT TIME ZONE 'Europe/Istanbul','HH24:MI:SS') AS zaman, direction, author, status, left(coalesce(error,'-'),60) AS hata FROM \"ConversationMessage\" WHERE \"createdAt\" > now() - interval '3 hours' ORDER BY \"createdAt\""
