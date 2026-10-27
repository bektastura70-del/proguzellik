#!/usr/bin/env bash
# PostgreSQL yedeği alır (pg_dump, özel biçim, sıkıştırılmış) ve SHA-256 özeti üretir.
# Kullanım: infra/scripts/backup.sh            (DB_NAME=proguzellik, BACKUP_DIR=./backups)
#           BACKUP_KEEP_DAYS=14 ile eski yedekler temizlenir (yalnızca bu dizindeki proguzellik-*.dump dosyaları).
# Salt okunur bir işlemdir; veritabanında değişiklik yapmaz.
source "$(dirname "$0")/_common.sh"

KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
STAMP="$(date -u +%Y%m%d-%H%M%S)"
FILE="$BACKUP_DIR/${DB_NAME}-${STAMP}.dump"

log "Yedek alınıyor: $DB_NAME → $FILE ($MODE)"
pg pg_dump -d "$DB_NAME" -Fc -Z 6 --no-password > "$FILE.partial"
mv "$FILE.partial" "$FILE"
chmod 600 "$FILE"
(cd "$BACKUP_DIR" && sha "$(basename "$FILE")" > "$(basename "$FILE").sha256")
SIZE=$(du -h "$FILE" | cut -f1)
log "Tamam: $SIZE"

# Dökümün okunabilir olduğunu doğrula (içindekiler listesi)
pg pg_restore --list < "$FILE" > /dev/null
log "İçerik listesi doğrulandı"

if [[ "$KEEP_DAYS" =~ ^[0-9]+$ ]] && (( KEEP_DAYS > 0 )); then
  find "$BACKUP_DIR" -maxdepth 1 -name "${DB_NAME}-*.dump*" -type f -mtime +"$KEEP_DAYS" -print -delete | sed 's/^/Silinen eski yedek: /' || true
fi
echo "$FILE"
