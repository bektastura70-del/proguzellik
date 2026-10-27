#!/usr/bin/env bash
# Yedeğin gerçekten geri yüklenebildiğini doğrular: geçici veritabanına yükler, tablo satır sayılarını
# kaynakla karşılaştırır, RLS'nin açık kaldığını kontrol eder ve geçici veritabanını siler.
# Kullanım: infra/scripts/verify-backup.sh backups/proguzellik-....dump
source "$(dirname "$0")/_common.sh"

FILE="${1:?Yedek dosyası verin}"
TMP="${DB_NAME}_verify_$(date -u +%Y%m%d%H%M%S)"
cleanup() { psql_q postgres "DROP DATABASE IF EXISTS \"$TMP\"" >/dev/null 2>&1 || true; }
trap cleanup EXIT

"$(dirname "$0")/restore.sh" "$FILE" "$TMP" >/dev/null

COUNT_SQL="SELECT string_agg(t || '=' || n, ' ' ORDER BY t) FROM (
  SELECT 'Tenant' t, count(*) n FROM \"Tenant\" UNION ALL SELECT 'User', count(*) FROM \"User\"
  UNION ALL SELECT 'Customer', count(*) FROM \"Customer\" UNION ALL SELECT 'Appointment', count(*) FROM \"Appointment\"
  UNION ALL SELECT 'FinanceTransaction', count(*) FROM \"FinanceTransaction\" UNION ALL SELECT 'AuditLog', count(*) FROM \"AuditLog\") x"
SRC=$(psql_q "$DB_NAME" "$COUNT_SQL")
DST=$(psql_q "$TMP" "$COUNT_SQL")
log "Kaynak : $SRC"
log "Yedek  : $DST"
RLS_OFF=$(psql_q "$TMP" "SELECT count(*) FROM pg_class c JOIN information_schema.columns col ON col.table_name=c.relname AND col.column_name='tenantId' AND col.table_schema='public' WHERE c.relkind='r' AND NOT (c.relrowsecurity AND c.relforcerowsecurity)")
MIG=$(psql_q "$TMP" "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL")
log "Uygulanmış migration: $MIG · RLS kapalı kiracı tablosu: $RLS_OFF"

if [[ "$RLS_OFF" != "0" ]]; then echo "HATA: geri yüklenen veritabanında RLS kapalı tablo var" >&2; exit 1; fi
# Yedek alındıktan sonra kaynakta yeni kayıt oluşmuş olabilir; yedek kaynaktan fazla olamaz.
python3 - "$SRC" "$DST" <<'PY'
import sys
src = dict(p.split("=") for p in sys.argv[1].split())
dst = dict(p.split("=") for p in sys.argv[2].split())
bad = [k for k in src if int(dst.get(k, -1)) < 0 or int(dst[k]) > int(src[k])]
missing = [k for k in src if int(dst.get(k, 0)) == 0 and int(src[k]) > 0]
if bad or missing:
    print("HATA: tutarsız satır sayıları:", bad + missing); sys.exit(1)
print("Satır sayıları tutarlı.")
PY
log "Doğrulama başarılı; geçici veritabanı siliniyor: $TMP"
