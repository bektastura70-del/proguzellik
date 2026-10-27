#!/usr/bin/env bash
# Yedeği GERİ YÜKLER. Varsayılan olarak YENİ bir veritabanına yükler; mevcut veritabanının üzerine yazmaz.
# Kullanım:
#   infra/scripts/restore.sh backups/proguzellik-20261027-120000.dump                 → proguzellik_restore_<zaman>
#   infra/scripts/restore.sh backups/... hedef_db                                     → hedef_db (yoksa oluşturulur; varsa durur)
#   CONFIRM_OVERWRITE=hedef_db infra/scripts/restore.sh backups/... hedef_db --overwrite → var olan hedefi siler ve yükler
source "$(dirname "$0")/_common.sh"

FILE="${1:?Yedek dosyası verin}"
TARGET="${2:-${DB_NAME}_restore_$(date -u +%Y%m%d%H%M%S)}"
OVERWRITE="${3:-}"

[[ -f "$FILE" ]] || { echo "Dosya bulunamadı: $FILE" >&2; exit 1; }
[[ "$TARGET" =~ ^[a-z0-9_]+$ ]] || { echo "Geçersiz veritabanı adı: $TARGET" >&2; exit 1; }

if [[ -f "$FILE.sha256" ]]; then
  (cd "$(dirname "$FILE")" && sha -c "$(basename "$FILE").sha256" >/dev/null) || { echo "SHA-256 doğrulaması başarısız: dosya bozuk veya değiştirilmiş" >&2; exit 1; }
  log "SHA-256 doğrulandı"
else
  log "UYARI: $FILE.sha256 yok, bütünlük doğrulanamadı"
fi

EXISTS=$(psql_q postgres "SELECT 1 FROM pg_database WHERE datname='$TARGET'")
if [[ "$EXISTS" == "1" ]]; then
  if [[ "$OVERWRITE" != "--overwrite" || "${CONFIRM_OVERWRITE:-}" != "$TARGET" ]]; then
    echo "Hedef veritabanı zaten var: $TARGET. Üzerine yazmak için CONFIRM_OVERWRITE=$TARGET ve --overwrite verin." >&2
    exit 2
  fi
  log "DİKKAT: $TARGET siliniyor (onaylandı)"
  psql_q postgres "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$TARGET' AND pid <> pg_backend_pid()" >/dev/null
  psql_q postgres "DROP DATABASE \"$TARGET\""
fi

psql_q postgres "CREATE DATABASE \"$TARGET\""
log "Geri yükleniyor → $TARGET"
# Sahiplik geri yüklemeyi yapan role verilir; app_tenant/app_platform yetkileri (GRANT) korunur.
pg pg_restore -d "$TARGET" --no-owner --exit-on-error < "$FILE"
log "Tamam. Uygulamayı bu veritabanına yönlendirmeden önce: npx prisma migrate status ve uygulama rol parolalarını kontrol edin."
echo "$TARGET"
