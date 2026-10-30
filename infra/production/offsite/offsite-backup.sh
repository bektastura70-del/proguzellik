#!/usr/bin/env bash
# Günlük sunucu dışı yedek (Backblaze B2). cron: /etc/cron.d/proguzellik-offsite  →  0 4 * * * root .../offsite-backup.sh
# 03:00 yerel yedeğinden sonra çalışır; yerel yedek cron'unu DEĞİŞTİRMEZ.
#   1) Güvenlik: kilit, disk (≥5 GB boş, ≤%90 dolu), yapılandırma, KVKK onay dosyası
#   2) En yeni BAŞARILI yerel yedek seçilir, yerel SHA-256 doğrulanır
#   3) age ile açık anahtara şifrelenir (özel anahtar sunucuda yok), şifreli dosyanın SHA-256'sı alınır
#   4) B2'ye yüklenir: B2 SHA-1 + fileInfo sha256 doğrulanır, nesne yeniden okunup karşılaştırılır; Object Lock varsa 14 gün saklama
#   5) Yalnız başarıdan sonra 14 günden eski uzak yedekler silinir (en yeni asla silinmez); başarısızlıkta hiçbir şey silinmez
# KVKK_ONAY dosyası yoksa gerçek veri YÜKLENMEZ (durum SKIPPED). Seçenek: --synthetic (yalnız şema dökümü, kişisel veri yok; test öneki)
set -euo pipefail
OFF=/opt/proguzellik/offsite
BK=/opt/proguzellik/backups
HERE="$(cd "$(dirname "$0")" && pwd)"
KEEP_DAYS="${OFFSITE_KEEP_DAYS:-14}"
MIN_FREE_GB=5; MAX_USED_PCT=90
STATUS="$OFF/last-status"; LOG="$OFF/offsite.log"
MODE=real; [[ "${1:-}" == "--synthetic" ]] && MODE=synthetic

exec >>"$LOG" 2>&1
log() { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }
status() { printf '%s %s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1" "${2:-}" > "$STATUS"; }
WORK=""
cleanup() { [[ -n "$WORK" && -d "$WORK" ]] && { find "$WORK" -type f -exec shred -u {} + 2>/dev/null; rm -rf "$WORK"; }; }
fail() { log "BULUT YEDEĞİ BAŞARISIZ: $*"; status FAIL "$*"; cleanup; exit 1; }
trap 'fail "satır $LINENO"' ERR
trap cleanup EXIT

exec 9>"$OFF/.offsite.lock"
flock -n 9 || fail "önceki aktarım hâlâ çalışıyor"
log "---- başlıyor ($MODE)"

read -r used_pct free_gb < <(df -BG --output=pcent,avail "$OFF" | tail -1 | tr -d '%G' | awk '{print $1, $2}')
(( free_gb >= MIN_FREE_GB && used_pct <= MAX_USED_PCT )) || fail "disk sınırı: %$used_pct dolu, ${free_gb} GB boş"
[[ -f "$OFF/b2.env" && -s "$OFF/age-recipient.txt" ]] || fail "yapılandırma eksik (offsite-setup.sh çalıştırılmadı)"

WORK=$(mktemp -d -p "$OFF" .work.XXXXXX); chmod 700 "$WORK"
STAMP=$(date -u +%Y%m%d-%H%M%S)

if [[ "$MODE" == real ]]; then
  if [[ ! -f "$OFF/KVKK_ONAY" ]]; then
    log "BEKLEMEDE: KVKK_ONAY yok; gerçek müşteri verisi yüklenmedi"
    status SKIPPED "KVKK onayı yok"; exit 0
  fi
  grep -q ' OK ' "$BK/last-status" || fail "son yerel yedek başarılı değil"
  SRC=$(ls -1t "$BK"/proguzellik-*.dump | head -1)
  (cd "$BK" && sha256sum -c --quiet "$(basename "$SRC").sha256") || fail "yerel yedek SHA-256 doğrulanamadı"
  SUB="db/"; NAME="proguzellik/db/$(basename "$SRC").age"; DAYS=$KEEP_DAYS
else
  SRC="$WORK/schema-$STAMP.dump"
  docker exec proguzellik-prod-postgres pg_dump -U proguzellik_owner -d proguzellik --schema-only -Fc </dev/null > "$SRC"
  SUB="test/"; NAME="proguzellik/test/schema-$STAMP.dump.age"; DAYS=1
fi
log "Kaynak: $(basename "$SRC") ($(du -h "$SRC" | cut -f1))"

ENC="$WORK/$(basename "$NAME")"
age -R "$OFF/age-recipient.txt" -o "$ENC" "$SRC"
head -c 21 "$ENC" | grep -q '^age-encryption.org/v1' || fail "şifreli dosya biçimi beklenmedik"
log "Şifrelendi (age, açık anahtar); SHA-256: $(sha256sum "$ENC" | cut -c1-16)…"

OUT=$(python3 -I "$HERE/b2.py" upload "$ENC" "$NAME" "$DAYS") || fail "yükleme/doğrulama hatası"
log "Yüklendi ve doğrulandı: $OUT"
FID=$(echo "$OUT" | jq -r .fileId); SHA=$(echo "$OUT" | jq -r .sha256)
python3 -I "$HERE/b2.py" verify "$FID" "$SHA" >/dev/null || fail "uzak nesne ikinci okumada doğrulanamadı"

if [[ "$MODE" == real ]]; then
  log "Saklama: $(python3 -I "$HERE/b2.py" prune "$SUB" "$KEEP_DAYS")"
fi
status OK "$MODE $NAME sha256=$SHA"
log "BULUT YEDEĞİ TAMAM ($MODE)"
L=$(wc -l < "$LOG"); (( L > 3000 )) && { tail -n 2000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"; }
exit 0
