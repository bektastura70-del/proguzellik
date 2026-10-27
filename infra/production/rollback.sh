#!/usr/bin/env bash
# Uygulamayı önceki sürüme döndürür (yalnızca api + worker + web; veritabanına dokunmaz).
# Kullanım: rollback.sh <önceki-sürüm>
# Not: Yeni sürüm geri alınamaz bir migration içeriyorsa önce docs/deployment.md "Veritabanı geri dönüşü" bölümü.
source "$(dirname "$0")/_lib.sh"
require_env_file
v="${1:?Kullanım: rollback.sh <önceki-sürüm>}"
[[ "$v" =~ ^[A-Za-z0-9._-]+$ ]] || die "Geçersiz sürüm adı"
if ! docker image inspect "proguzellik-api:$v" "proguzellik-web:$v" >/dev/null 2>&1; then
  f="$IMAGE_DIR/proguzellik-$v.tar.gz"
  [[ -f "$f" ]] || die "İmaj ne Docker'da ne arşivde var: $v"
  (cd "$IMAGE_DIR" && sha -c "$(basename "$f").sha256") || die "Arşiv bozuk"
  gunzip -c "$f" | docker load
fi
current=$(env_get APP_VERSION)
cp "$ENV_FILE" "$ENV_FILE.bak-$(date +%Y%m%d%H%M%S)"; chmod 600 "$ENV_FILE".bak-*
sed -i.tmp "s/^APP_VERSION=.*/APP_VERSION=$v/" "$ENV_FILE" && rm -f "$ENV_FILE.tmp"; chmod 600 "$ENV_FILE"
log "APP_VERSION: $current → $v"
"${COMPOSE[@]}" up -d --no-deps api worker web
for i in $(seq 1 30); do
  s=$(docker inspect -f '{{.State.Health.Status}}' proguzellik-prod-api 2>/dev/null || echo yok)
  [[ "$s" == healthy ]] && { log "API sağlıklı. Geri dönüş tamam."; exit 0; }
  sleep 5
done
die "API 150 sn içinde sağlıklı olmadı; docker logs proguzellik-prod-api"
