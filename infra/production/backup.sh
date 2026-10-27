#!/usr/bin/env bash
# Canlı veritabanı yedeği (cron ile günlük). Ortak yedek betiğini canlı konteynerle çalıştırır.
# cron örneği (/etc/cron.d/proguzellik-backup):
#   45 3 * * * root /opt/proguzellik/infra/production/backup.sh >> /opt/proguzellik/backups/backup.log 2>&1
source "$(dirname "$0")/_lib.sh"
require_env_file
owner=$(env_get PG_OWNER_USER); db=$(env_get PG_DB)
export PG_CONTAINER=proguzellik-prod-postgres PGUSER="${owner:-proguzellik_owner}" DB_NAME="${db:-proguzellik}"
export BACKUP_DIR BACKUP_KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
unset PGHOST
exec "$PROD_DIR/../scripts/backup.sh"
