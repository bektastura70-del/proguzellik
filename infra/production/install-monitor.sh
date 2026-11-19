#!/usr/bin/env bash
# İzlemeyi kurar: /etc/cron.d/proguzellik-monitor (5 dakikada bir monitor.sh) + deneme e-postası.
# Geri alma: rm -f /etc/cron.d/proguzellik-monitor   (veri silmez; /opt/proguzellik/monitor yalnız durum dosyaları)
# Uyarı adresi: .env'de MONITOR_ALERT_EMAIL (yoksa info@proguzellik.com).
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_lib.sh"
[[ $EUID -eq 0 ]] || die "root olarak çalıştırın"
require_env_file
[[ -n "$(env_get SMTP_URL || true)" ]] || die ".env'de SMTP_URL yok; e-posta gönderilemez"
command -v curl >/dev/null && command -v openssl >/dev/null || die "curl ve openssl gerekli"
chmod +x "$PROD_DIR/monitor.sh"
mkdir -p /opt/proguzellik/monitor && chmod 700 /opt/proguzellik/monitor

log "Şu anki durum:"
bash "$PROD_DIR/monitor.sh" --durum || log "(yukarıdaki sorunlar kurulumdan sonra e-postayla bildirilecek)"

cat > /etc/cron.d/proguzellik-monitor <<CRON
# Pro Güzellik izleme (install-monitor.sh). Kaldırmak için bu dosyayı silin.
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
*/5 * * * * root $PROD_DIR/monitor.sh >> /opt/proguzellik/monitor/monitor.log 2>&1
CRON
chmod 644 /etc/cron.d/proguzellik-monitor
log "Cron kuruldu: /etc/cron.d/proguzellik-monitor"

if bash "$PROD_DIR/monitor.sh" --test; then
  log "Deneme e-postası gönderildi: $(env_get MONITOR_ALERT_EMAIL || true) (boşsa info@proguzellik.com). Gelen kutusunu ve spam klasörünü kontrol edin."
else
  die "Deneme e-postası GÖNDERİLEMEDİ. Cron kurulu kaldı ama uyarı gitmez; çıktıyı Claude'a iletin. Geri alma: rm -f /etc/cron.d/proguzellik-monitor"
fi
log "TAMAM"
