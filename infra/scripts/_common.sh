#!/usr/bin/env bash
# Ortak yardımcılar: PostgreSQL araçlarını yerelde (pg_dump/pg_restore) ya da Docker konteyneri içinde çalıştırır.
set -euo pipefail

PG_CONTAINER="${PG_CONTAINER:-proguzellik-postgres}"
PGUSER="${PGUSER:-proguzellik}"
DB_NAME="${DB_NAME:-proguzellik}"
BACKUP_DIR="${BACKUP_DIR:-$(cd "$(dirname "$0")/../.." && pwd)/backups}"

# PGHOST tanımlıysa ve araçlar kuruluysa doğrudan bağlanılır (canlı ortam); aksi hâlde yerel Docker konteyneri kullanılır.
if [[ -n "${PGHOST:-}" ]] && command -v pg_dump >/dev/null 2>&1; then
  MODE="direct"
else
  MODE="docker"
fi

pg() { # pg <araç> <argümanlar...>   (stdin/stdout aktarılır)
  local tool="$1"; shift
  if [[ "$MODE" == "direct" ]]; then
    "$tool" "$@"
  else
    docker exec -i "$PG_CONTAINER" "$tool" -U "$PGUSER" "$@"
  fi
}

psql_q() { # psql_q <db> <sql>
  if [[ "$MODE" == "direct" ]]; then
    psql -X -v ON_ERROR_STOP=1 -tA -d "$1" -c "$2"
  else
    docker exec -i "$PG_CONTAINER" psql -X -U "$PGUSER" -v ON_ERROR_STOP=1 -tA -d "$1" -c "$2"
  fi
}

sha() { if command -v sha256sum >/dev/null; then sha256sum "$@"; else shasum -a 256 "$@"; fi; }
log() { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }
