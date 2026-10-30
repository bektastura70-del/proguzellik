#!/usr/bin/env bash
# Canlı veritabanı yedeği (cron ile günlük). Yalnızca proguzellik-prod-postgres içindeki ProGüzellik
# veritabanını yedekler; yalnızca $BACKUP_DIR içindeki proguzellik-*.dump dosyalarını temizler.
# cron (/etc/cron.d/proguzellik-backup, sunucu saat dilimi Europe/Istanbul):
#   0 3 * * * root /opt/proguzellik/infra/production/backup.sh >> /opt/proguzellik/backups/backup.log 2>&1
#
# Güvenlik sınırları (yedek ALINMADAN önce kontrol edilir; aşılırsa yedek alınmaz, BAŞARISIZ loglanır):
#   BACKUP_MIN_FREE_GB  (5)    diskte en az bu kadar boş alan
#   BACKUP_MAX_USED_PCT (90)   disk doluluğu en fazla bu yüzde
#   BACKUP_MAX_DIR_MB   (2048) yedek dizini toplamı en fazla bu boyut
#   BACKUP_KEEP_DAYS    (7)    son 7 günün yedekleri tutulur
#   RESTORE_TEST_WEEKDAY (7)   haftanın bu gününde (1=Pzt … 7=Paz) geçici veritabanına geri yükleme testi; 0 = kapalı
source "$(dirname "$0")/_lib.sh"
require_env_file

MIN_FREE_GB="${BACKUP_MIN_FREE_GB:-5}"
MAX_USED_PCT="${BACKUP_MAX_USED_PCT:-90}"
MAX_DIR_MB="${BACKUP_MAX_DIR_MB:-2048}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-7}"
TEST_DAY="${RESTORE_TEST_WEEKDAY:-7}"
STATUS_FILE="$BACKUP_DIR/last-status"

status() { printf '%s %s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1" "${2:-}" > "$STATUS_FILE"; }
on_err() { log "YEDEK BAŞARISIZ (satır $1)"; status FAIL "satır $1"; rm -f "$BACKUP_DIR"/*.partial; }
trap 'on_err $LINENO' ERR

# Aynı anda iki yedek çalışmasın
exec 9>"$BACKUP_DIR/.backup.lock"
flock -n 9 || { log "YEDEK BAŞARISIZ: önceki yedek hâlâ çalışıyor"; status FAIL "kilit"; exit 1; }

# Disk sınırları
read -r used_pct free_gb < <(df -BG --output=pcent,avail "$BACKUP_DIR" | tail -1 | tr -d '%G' | awk '{print $1, $2}')
dir_mb=$(du -sm "$BACKUP_DIR" | cut -f1)
log "Disk: %$used_pct dolu, ${free_gb} GB boş; yedek dizini ${dir_mb} MB"
if (( free_gb < MIN_FREE_GB )) || (( used_pct > MAX_USED_PCT )) || (( dir_mb > MAX_DIR_MB )); then
  log "YEDEK BAŞARISIZ: disk sınırı aşıldı (boş ≥${MIN_FREE_GB} GB, doluluk ≤%${MAX_USED_PCT}, dizin ≤${MAX_DIR_MB} MB gerekir)"
  status FAIL "disk sınırı"; exit 1
fi

owner=$(env_get PG_OWNER_USER); db=$(env_get PG_DB)
export PG_CONTAINER=proguzellik-prod-postgres PGUSER="${owner:-proguzellik_owner}" DB_NAME="${db:-proguzellik}"
export BACKUP_DIR BACKUP_KEEP_DAYS=0   # temizlik aşağıda, yalnızca başarılı yedekten sonra
unset PGHOST

file=$("$PROD_DIR/../scripts/backup.sh" | tail -1)
[[ -s "$file" ]] || { log "YEDEK BAŞARISIZ: dosya boş"; status FAIL "boş dosya"; exit 1; }
(cd "$BACKUP_DIR" && sha -c --quiet "$(basename "$file").sha256")
log "Bütünlük (SHA-256) doğrulandı: $(basename "$file")"

if [[ "$TEST_DAY" != 0 && "$(date +%u)" == "$TEST_DAY" ]]; then
  log "Haftalık geri yükleme testi"
  "$PROD_DIR/../scripts/verify-backup.sh" "$file"
fi

# Saklama: son KEEP_DAYS günün yedekleri; yalnızca bu dizindeki proguzellik-*.dump(.sha256)
if [[ "$KEEP_DAYS" =~ ^[0-9]+$ ]] && (( KEEP_DAYS > 0 )); then
  find "$BACKUP_DIR" -maxdepth 1 -type f -name "${DB_NAME}-*.dump*" -mtime +"$((KEEP_DAYS - 1))" -print -delete | sed 's/^/Silinen eski yedek: /' || true
fi

# Log dosyası büyümesin (son 2000 satır)
logf="$BACKUP_DIR/backup.log"
if [[ -f "$logf" ]] && (( $(wc -l < "$logf") > 2000 )); then tail -n 2000 "$logf" > "$logf.tmp" && mv "$logf.tmp" "$logf"; fi

status OK "$(basename "$file") $(du -h "$file" | cut -f1)"
log "YEDEK TAMAM: $file"
echo "$file"
