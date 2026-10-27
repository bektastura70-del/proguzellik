#!/usr/bin/env bash
# Migration'ların NOLOGIN oluşturduğu uygulama rollerine (.env'deki) parolalarla giriş izni verir.
# İlk kurulumda ve parola değişiminde çalıştırılır. Parolalar komut satırına/loga yazılmaz (stdin ile gider).
source "$(dirname "$0")/_lib.sh"
require_env_file
tenant=$(env_get APP_TENANT_DB_PASSWORD); platform=$(env_get APP_PLATFORM_DB_PASSWORD)
owner=$(env_get PG_OWNER_USER); owner=${owner:-proguzellik_owner}
db=$(env_get PG_DB); db=${db:-proguzellik}
for v in "$tenant" "$platform"; do [[ "$v" =~ ^[0-9a-f]{64}$ ]] || die "Uygulama rolü parolası 64 karakter hex olmalı"; done
docker exec -i proguzellik-prod-postgres psql -X -q -v ON_ERROR_STOP=1 -U "$owner" -d "$db" <<SQL
ALTER ROLE app_tenant LOGIN PASSWORD '$tenant';
ALTER ROLE app_platform LOGIN PASSWORD '$platform';
SQL
log "Uygulama rollerine giriş izni verildi."
