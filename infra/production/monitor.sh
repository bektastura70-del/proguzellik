#!/usr/bin/env bash
# Pro Güzellik canlı izleme. Cron ile 5 dakikada bir çalışır (/etc/cron.d/proguzellik-monitor).
# Denetimler: site, API, kapsayıcılar, gece yedeği (yerel), disk, TLS sertifikası.
# Sorun 2 ardışık çalıştırmada sürerse e-posta gider; sürdükçe 6 saatte bir hatırlatır; düzelince "düzeldi" e-postası gider.
# E-posta, .env'deki SMTP_URL ile (uygulamanın kullandığı hesap) host üzerindeki curl'den gönderilir; parola ekrana/komut satırına yazılmaz.
#   monitor.sh          denetle (cron)
#   monitor.sh --durum  denetle, sonucu ekrana yaz, e-posta gönderme
#   monitor.sh --test   deneme e-postası gönder
set -uo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_lib.sh"
set +e  # _lib.sh -e açar; izleme tek bir denetim hatasında yarıda kalmamalı

SITE="${MONITOR_SITE:-https://proguzellik.com}"
STATE_DIR="${MONITOR_DIR:-/opt/proguzellik/monitor}"
PROJECT="${MONITOR_PROJECT:-proguzellik-prod}"
REMIND_SECONDS=$((6 * 3600))
mkdir -p "$STATE_DIR"; chmod 700 "$STATE_DIR"

ALERT_TO="$(env_get MONITOR_ALERT_EMAIL || true)"; ALERT_TO="${ALERT_TO:-info@proguzellik.com}"

send_mail() { # $1 konu, $2 gövde
  local url from addr
  url="$(env_get SMTP_URL || true)"
  [[ -n "$url" ]] || { log "SMTP_URL yok; e-posta gönderilemedi: $1"; return 1; }
  from="$(env_get EMAIL_FROM || true)"; addr="$(grep -oE '[^<> ]+@[^<> ]+' <<<"${from:-info@proguzellik.com}" | head -1)"
  local subj; subj="=?UTF-8?B?$(printf '%s' "$1" | base64 -w0)?="
  printf 'From: =?UTF-8?B?UHJvR8O8emVsbGlrIMSwemxlbWU=?= <%s>\r\nTo: %s\r\nSubject: %s\r\nDate: %s\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n%s\r\n' \
    "$addr" "$ALERT_TO" "$subj" "$(LC_ALL=C date -R)" "$2" > "$STATE_DIR/mail.txt"
  # URL (içinde parola var) curl'e stdin üzerinden yapılandırma olarak verilir, süreç listesinde görünmez.
  printf 'url = "%s"\nmail-from = "%s"\nmail-rcpt = "%s"\nupload-file = "%s"\n' "$url" "$addr" "$ALERT_TO" "$STATE_DIR/mail.txt" \
    | curl -sS --ssl-reqd -m 60 -K - >/dev/null 2>"$STATE_DIR/mail.err"
  local rc=$?; rm -f "$STATE_DIR/mail.txt"
  if [[ $rc -ne 0 ]]; then log "e-posta gönderilemedi (curl $rc): $(head -c 200 "$STATE_DIR/mail.err")"; return 1; fi
  log "e-posta gönderildi: $1"
}

problems=()
check() { problems+=("$1"); }

# 1) Site ve API (dışarıdan görüldüğü gibi: Caddy + web + api)
code=$(curl -s -o /dev/null -m 20 -w '%{http_code}' "$SITE/") || code=000
[[ "$code" == 200 ]] || check "Ana sayfa yanıt vermiyor (HTTP $code)"
body=$(curl -s -m 20 "$SITE/api/p/purchase/status") || body=""
grep -q '"enabled"' <<<"$body" || check "API yanıt vermiyor (/api/p/purchase/status)"

# 2) Kapsayıcılar: çalışmayan ya da sağlıksız olan
while read -r name status; do
  [[ -z "$name" ]] && continue
  case "$status" in
    Up*unhealthy*) check "Kapsayıcı sağlıksız: $name" ;;
    Up*) ;;
    *) check "Kapsayıcı çalışmıyor: $name ($status)" ;;
  esac
done < <(docker ps -a --filter "label=com.docker.compose.project=$PROJECT" --format '{{.Names}} {{.Status}}' 2>/dev/null)
[[ $(docker ps -q --filter "label=com.docker.compose.project=$PROJECT" 2>/dev/null | wc -l) -gt 0 ]] || check "Hiç kapsayıcı çalışmıyor ($PROJECT)"

# 3) Gece yedeği: son durum OK ve 26 saatten yeni olmalı
bs="$BACKUP_DIR/last-status"
if [[ ! -f "$bs" ]]; then check "Yedek durum dosyası yok ($bs)"
else
  grep -q ' OK ' "$bs" || check "Son yedek başarısız: $(head -c 200 "$bs")"
  age=$(( $(date +%s) - $(stat -c %Y "$bs") ))
  (( age < 26 * 3600 )) || check "Son yedek $((age / 3600)) saat önce; gece yedeği çalışmamış olabilir"
fi

# 4) Disk
used=$(df -P / | awk 'NR==2 {gsub("%","",$5); print $5}')
(( used < 90 )) || check "Disk doluluğu %$used"

# 5) TLS sertifikası (14 günden az kaldıysa)
host="${SITE#https://}"; host="${host%%/*}"
end=$(echo | timeout 20 openssl s_client -servername "$host" -connect "$host:443" 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)
if [[ -n "$end" ]]; then
  left=$(( ($(date -d "$end" +%s) - $(date +%s)) / 86400 ))
  (( left >= 14 )) || check "TLS sertifikasının bitmesine $left gün var"
else check "TLS sertifikası okunamadı"; fi

report="$(printf '%s\n' "${problems[@]+"${problems[@]}"}")"
now=$(date +%s)

if [[ "${1:-}" == "--durum" ]]; then
  if ((${#problems[@]})); then printf 'SORUN:\n%s\n' "$report"; exit 1; else echo "Her şey yolunda"; exit 0; fi
fi
if [[ "${1:-}" == "--test" ]]; then
  send_mail "ProGüzellik izleme: deneme e-postası" "Bu bir deneme e-postasıdır. İzleme kuruldu.

Şu anki durum:
${report:-Her şey yolunda}

Sunucu: $(hostname), $(date '+%Y-%m-%d %H:%M:%S')"
  exit $?
fi

fails=$(cat "$STATE_DIR/fail-count" 2>/dev/null || echo 0)
alerted=$(cat "$STATE_DIR/alerted-at" 2>/dev/null || echo 0)
if ((${#problems[@]})); then
  fails=$((fails + 1)); echo "$fails" > "$STATE_DIR/fail-count"
  log "SORUN ($fails. kez): ${report//$'\n'/; }"
  due=0
  if (( fails >= 2 )); then
    if (( alerted == 0 )) || (( now - alerted >= REMIND_SECONDS )) || [[ "$report" != "$(cat "$STATE_DIR/last-report" 2>/dev/null)" ]]; then due=1; fi
  fi
  if (( due )); then
    if send_mail "ProGüzellik UYARI: $(head -1 <<<"$report")" "ProGüzellik canlı sisteminde sorun var:

$report

Zaman: $(date '+%Y-%m-%d %H:%M:%S') (sunucu saati)
Durumu görmek için: ssh prososyalmedya 'bash /opt/proguzellik/infra/production/monitor.sh --durum'
Sorun sürdükçe 6 saatte bir hatırlatılır."; then
      echo "$now" > "$STATE_DIR/alerted-at"; printf '%s' "$report" > "$STATE_DIR/last-report"
    fi
  fi
else
  if (( alerted != 0 )); then
    send_mail "ProGüzellik: sorun düzeldi" "Önceki uyarıdaki sorunlar artık görünmüyor.

Zaman: $(date '+%Y-%m-%d %H:%M:%S') (sunucu saati)" && rm -f "$STATE_DIR/alerted-at" "$STATE_DIR/last-report"
  fi
  echo 0 > "$STATE_DIR/fail-count"
fi
