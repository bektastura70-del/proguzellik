#!/usr/bin/env bash
# Canlı ortam betikleri için ortak yardımcılar. Konum: /opt/proguzellik/infra/production
set -euo pipefail
PROD_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${ENV_FILE:-$PROD_DIR/.env}"
# COMPOSE_FILE .env içinden okunur (kenar ağı katmanı dahil olsun diye -f verilmez)
COMPOSE=(docker compose --project-directory "$PROD_DIR" --env-file "$ENV_FILE")
IMAGE_DIR="${IMAGE_DIR:-/opt/proguzellik/images}"
BACKUP_DIR="${BACKUP_DIR:-/opt/proguzellik/backups}"

sha() { if command -v sha256sum >/dev/null; then sha256sum "$@"; else shasum -a 256 "$@"; fi; }
log() { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }
die() { log "HATA: $*" >&2; exit 1; }

# .env içinden tek değişken okur (dosyayı source etmeden; değer ekrana yazılmaz)
env_get() { grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- ; }

require_env_file() {
  [[ -f "$ENV_FILE" ]] || die ".env bulunamadı: $ENV_FILE"
  local perm; perm=$(stat -c '%a' "$ENV_FILE" 2>/dev/null || stat -f '%Lp' "$ENV_FILE")
  [[ "$perm" == "600" || "$perm" == "400" ]] || die ".env izni $perm; 600 olmalı (chmod 600 $ENV_FILE)"
}
