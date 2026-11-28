#!/usr/bin/env bash
# SALT OKUNUR: online randevu alan salonlarda bildirim yollarının ve müşteri kayıtlarının durumu (son N gün, varsayılan 3).
# Ad, e-posta ve telefon YAZDIRILMAZ; telefon yalnızca yazım biçimi olarak (rakamlar 9) ve son 2 hane gösterilir.
#   bash check-online-bookings.sh [gün]
set -Eeuo pipefail
cd /opt/proguzellik/infra/production
DAYS="${1:-3}"; [[ "$DAYS" =~ ^[0-9]+$ ]] || { echo "gün sayı olmalı"; exit 1; }
env_get() { { grep -E "^$1=" .env || true; } | tail -1 | cut -d= -f2- ; }
owner=$(env_get PG_OWNER_USER); db=$(env_get PG_DB)
psqlq() { docker exec -i proguzellik-prod-postgres psql -X -U "${owner:-proguzellik_owner}" -d "${db:-proguzellik}" -P pager=off -c "BEGIN READ ONLY; $1; COMMIT;" | grep -v -E '^(BEGIN|COMMIT)$'; }
ts() { local c="${1//\\/}"; echo "to_char($c AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Istanbul','DD.MM HH24:MI')"; }
W="> now() - interval '$DAYS days'"

echo "== Ortam: PWA ve push ana anahtarları"
for k in PWA_ENABLED WEB_PUSH_MODE EMAIL_MODE; do printf '%-16s %s\n' "$k" "$(env_get $k)"; done

echo; echo "== Son $DAYS günde online randevu alan salonlar: PWA bayrakları, WhatsApp, yetkili sayısı"
psqlq "SELECT t.slug, t.status AS durum, coalesce(s.\"businessPwaEnabled\"::text,'kayıt yok') AS isletme_pwa, coalesce(s.\"webPushEnabled\"::text,'-') AS push, coalesce(c.status::text,'bağlı değil') AS whatsapp, (SELECT count(*) FROM \"Membership\" m WHERE m.\"tenantId\"=t.id AND m.\"isActive\" AND m.role IN ('OWNER','MANAGER','RECEPTION')) AS yetkili, (SELECT count(*) FROM \"Appointment\" a WHERE a.\"tenantId\"=t.id AND a.source='ONLINE' AND a.\"createdAt\" $W) AS online_randevu FROM \"Tenant\" t LEFT JOIN \"TenantPwaSettings\" s ON s.\"tenantId\"=t.id LEFT JOIN \"ChannelConnection\" c ON c.\"tenantId\"=t.id AND c.channel='WHATSAPP' WHERE EXISTS (SELECT 1 FROM \"Appointment\" a WHERE a.\"tenantId\"=t.id AND a.source='ONLINE' AND a.\"createdAt\" $W) ORDER BY t.slug"

echo "== Bu randevular için yazılan bildirimler (kanal / şablon / durum)"
psqlq "SELECT t.slug, n.channel AS kanal, n.template AS sablon, n.status AS durum, left(coalesce(n.error,'-'),50) AS hata, count(*) FROM \"Notification\" n JOIN \"Appointment\" a ON a.id=n.\"appointmentId\" JOIN \"Tenant\" t ON t.id=a.\"tenantId\" WHERE a.source='ONLINE' AND a.\"createdAt\" $W GROUP BY 1,2,3,4,5 ORDER BY 1,2,3"
psqlq "SELECT t.slug, i.type AS tur, (i.\"readAt\" IS NOT NULL) AS okundu, count(*) FROM \"InAppNotification\" i JOIN \"Appointment\" a ON a.id=i.\"appointmentId\" JOIN \"Tenant\" t ON t.id=a.\"tenantId\" WHERE a.source='ONLINE' AND a.\"createdAt\" $W GROUP BY 1,2,3 ORDER BY 1,2"

echo "== Bu salonlarda son $DAYS günde açılan müşteri kayıtları (telefon biçimi; ad/telefon gizli)"
psqlq "SELECT t.slug, $(ts 'cu.\"createdAt\"') AS acildi, cu.source AS kaynak, regexp_replace(coalesce(cu.phone,'-'),'[0-9]','9','g') AS tel_bicimi, right(cu.phone,2) AS son2, (cu.email IS NOT NULL) AS eposta_var, (SELECT count(*) FROM \"Customer\" o WHERE o.\"tenantId\"=cu.\"tenantId\" AND o.id<>cu.id AND right(regexp_replace(o.phone,'[^0-9]','','g'),10)=right(regexp_replace(cu.phone,'[^0-9]','','g'),10)) AS ayni_numara_baska_kayit, (SELECT count(*) FROM \"Customer\" o WHERE o.\"tenantId\"=cu.\"tenantId\" AND o.id<>cu.id AND lower(o.\"firstName\"||' '||o.\"lastName\")=lower(cu.\"firstName\"||' '||cu.\"lastName\")) AS ayni_ad_baska_kayit FROM \"Customer\" cu JOIN \"Tenant\" t ON t.id=cu.\"tenantId\" WHERE cu.\"createdAt\" $W AND EXISTS (SELECT 1 FROM \"Appointment\" a WHERE a.\"tenantId\"=t.id AND a.source='ONLINE' AND a.\"createdAt\" $W) ORDER BY t.slug, cu.\"createdAt\""

echo; echo "== Telefon bildirimi (Web Push) abonelikleri: işletme/kitle başına (adres ve anahtar YAZDIRILMAZ)"
psqlq "SELECT t.slug, p.audience AS kitle, count(*) FILTER (WHERE p.\"revokedAt\" IS NULL) AS etkin, count(*) FILTER (WHERE p.\"revokedAt\" IS NOT NULL) AS iptal, max($(ts 'p.\"createdAt\"')) AS son_abone, max($(ts 'p.\"lastSuccessAt\"')) AS son_basarili, max(p.failures) AS max_hata FROM \"PushSubscription\" p JOIN \"Tenant\" t ON t.id=p.\"tenantId\" GROUP BY 1,2 ORDER BY 1,2"
echo "== Son $DAYS günde işletme kullanıcılarına giden telefon bildirimleri (şablon / durum / hata)"
psqlq "SELECT t.slug, n.template AS sablon, n.status AS durum, left(coalesce(n.error,'-'),50) AS hata, count(*) FROM \"Notification\" n JOIN \"Tenant\" t ON t.id=n.\"tenantId\" WHERE n.channel='WEBPUSH' AND n.recipient LIKE 'user:%' AND n.\"createdAt\" $W GROUP BY 1,2,3,4 ORDER BY 1,2,3"
