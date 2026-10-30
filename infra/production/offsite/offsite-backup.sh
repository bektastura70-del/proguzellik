#!/usr/bin/env bash
# Günlük sunucu dışı yedek (Google Drive). cron: /etc/cron.d/proguzellik-offsite  →  0 4 * * * root .../offsite-backup.sh
# 03:00 yerel yedeğinden sonra çalışır; yerel yedek cron'unu DEĞİŞTİRMEZ.
#   1) Güvenlik: kilit, disk (≥5 GB boş, ≤%90 dolu), yapılandırma, KVKK onay dosyası
#   2) En yeni BAŞARILI yerel yedek seçilir, yerel SHA-256 doğrulanır
#   3) age ile açık anahtara şifrelenir (özel anahtar sunucuda yok); şifreli dosyanın SHA-256'sı .sha256 olarak yanına konur
#   4) Drive'a yüklenir, sonra GERİ İNDİRİLİP SHA-256 karşılaştırılır (uzak bütünlük)
#   5) Yalnız başarıdan sonra 14 günden eski uzak yedekler Drive çöp kutusuna taşınır (30 gün geri alınabilir);
#      en yeni yedek asla silinmez; başarısızlıkta hiçbir şey silinmez
# KVKK_ONAY dosyası yoksa gerçek veri YÜKLENMEZ (durum SKIPPED). --synthetic: yalnız şema dökümü (kişisel veri yok), test/ klasörü
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
source "$HERE/_offsite.sh"
BK=/opt/proguzellik/backups
KEEP_DAYS="${OFFSITE_KEEP_DAYS:-14}"
MIN_FREE_GB=5; MAX_USED_PCT=90
STATUS="$OFF/last-status"; LOG="$OFF/offsite.log"
MODE=real; [[ "${1:-}" == "--synthetic" ]] && MODE=synthetic

exec >>"$LOG" 2>&1 </dev/null
status() { printf '%s %s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1" "${2:-}" > "$STATUS"; }
WORK=""
cleanup() { [[ -n "$WORK" && -d "$WORK" ]] && { find "$WORK" -type f -exec shred -u {} + 2>/dev/null; rm -rf "$WORK"; } || true; }
fail() { log "BULUT YEDEĞİ BAŞARISIZ: $*"; status FAIL "$*"; cleanup; exit 1; }
trap 'fail "satır $LINENO"' ERR
trap cleanup EXIT

exec 9>"$OFF/.offsite.lock"
flock -n 9 || fail "önceki aktarım hâlâ çalışıyor"
log "---- başlıyor ($MODE)"

read -r used_pct free_gb < <(df -BG --output=pcent,avail "$OFF" | tail -1 | tr -d '%G' | awk '{print $1, $2}')
(( free_gb >= MIN_FREE_GB && used_pct <= MAX_USED_PCT )) || fail "disk sınırı: %$used_pct dolu, ${free_gb} GB boş"
[[ -s "$OFF/rclone/rclone.conf" && -s "$OFF/age-recipient.txt" ]] || fail "yapılandırma eksik (offsite-setup.sh çalıştırılmadı)"

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
  SUB=db; NAME="$(basename "$SRC").age"
else
  SRC="$WORK/schema-$STAMP.dump"
  docker exec proguzellik-prod-postgres pg_dump -U proguzellik_owner -d proguzellik --schema-only -Fc > "$SRC"
  SUB=test; NAME="schema-$STAMP.dump.age"
fi
log "Kaynak: $(basename "$SRC") ($(du -h "$SRC" | cut -f1))"

age -R "$OFF/age-recipient.txt" -o "$WORK/$NAME" "$SRC"
head -c 21 "$WORK/$NAME" | grep -q '^age-encryption.org/v1' || fail "şifreli dosya biçimi beklenmedik"
SHA=$(sha256sum "$WORK/$NAME" | cut -d' ' -f1)
echo "$SHA  $NAME" > "$WORK/$NAME.sha256"
[[ "$MODE" == synthetic ]] && rm -f "$SRC"
log "Şifrelendi (age, açık anahtar); SHA-256 $SHA"

rc_data "$WORK" copyto "/data/$NAME" "$REMOTE/$SUB/$NAME" || fail "yükleme hatası"
rc_data "$WORK" copyto "/data/$NAME.sha256" "$REMOTE/$SUB/$NAME.sha256" || fail "özet yükleme hatası"
install -d -m 700 "$WORK/check"
rc_data "$WORK/check" copyto "$REMOTE/$SUB/$NAME" "/data/$NAME" || fail "doğrulama için geri indirilemedi"
[[ "$(sha256sum "$WORK/check/$NAME" | cut -d' ' -f1)" == "$SHA" ]] || fail "Drive'daki dosyanın SHA-256'sı uyuşmuyor"
log "Yüklendi ve geri indirilerek doğrulandı: $SUB/$NAME"

if [[ "$MODE" == real ]]; then
  # Yeni yedek az önce doğrulandı; 14 günden eskiler çöp kutusuna (yalnız ProGuzellikYedek/db içinde)
  rc delete "$REMOTE/db" --min-age "${KEEP_DAYS}d" --include "proguzellik-*.dump.age*" >/dev/null 2>&1 || log "UYARI: eski yedek temizliği başarısız (yeni yedek güvende)"
  log "Drive'daki yedek sayısı: $(rc lsf "$REMOTE/db" --include '*.age' 2>/dev/null | wc -l)"
fi
status OK "$MODE $SUB/$NAME sha256=$SHA"
log "BULUT YEDEĞİ TAMAM ($MODE)"
L=$(wc -l < "$LOG"); (( L > 3000 )) && { tail -n 2000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"; }
exit 0
