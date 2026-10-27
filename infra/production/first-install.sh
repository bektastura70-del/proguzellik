#!/usr/bin/env bash
# ProGüzellik İLK KURULUM (sunucuda, root). Yalnızca ProGüzellik kaynaklarını oluşturur:
#   compose projesi "proguzellik-prod", konteynerler proguzellik-prod-*, volume'lar proguzellik_prod_*,
#   ağ proguzellik_prod_internal. Ortak vekil ağına BAĞLANMAZ, Caddy/DNS'e dokunmaz, port yayınlamaz.
#
# Kullanım: /opt/proguzellik/infra/production/first-install.sh <sürüm>
#   <sürüm>: yüklü imaj etiketi (proguzellik-api:<sürüm>, proguzellik-web:<sürüm>)
# Sırlar sunucuda üretilir, .env'e (600) yazılır ve EKRANA YAZILMAZ. .env varsa yeniden üretilmez.
# Seed/demo verisi çalıştırılmaz. Platform sahibi hesabı OLUŞTURULMAZ (ayrı prosedür).
source "$(dirname "$0")/_lib.sh"
V="${1:?Kullanım: first-install.sh <sürüm>}"
[[ "$V" =~ ^[A-Za-z0-9._-]+$ ]] || die "Geçersiz sürüm adı"
cd "$PROD_DIR"

step() { printf '\n== %s\n' "$*"; }
fail=0
check() { if eval "$2" >/dev/null 2>&1; then log "OK    $1"; else log "HATA  $1"; fail=1; fi; }

step "1/9 İmajlar"
docker image inspect "proguzellik-api:$V" "proguzellik-web:$V" >/dev/null || die "İmajlar yüklü değil: $V"
for img in postgres:16-alpine redis:7-alpine; do docker image inspect "$img" >/dev/null 2>&1 || log "UYARI $img yerelde yok; çekilecek"; done
log "İmajlar hazır"

step "2/9 Ortam dosyası ve sırlar"
if [[ -f "$ENV_FILE" ]]; then
  log ".env zaten var; sırlar yeniden üretilmedi"
  grep -q "^APP_VERSION=$V$" "$ENV_FILE" || die ".env'deki APP_VERSION $V değil; elle kontrol edin"
else
  (
    umask 077
    {
      echo "APP_VERSION=$V"
      echo "PUBLIC_URL=https://proguzellik.com"
      echo "PG_OWNER_USER=proguzellik_owner"
      echo "PG_DB=proguzellik"
      for k in PG_OWNER_PASSWORD APP_TENANT_DB_PASSWORD APP_PLATFORM_DB_PASSWORD REDIS_PASSWORD JWT_SECRET MFA_ENCRYPTION_KEY; do
        echo "$k=$(openssl rand -hex 32)"
      done
      echo "REGISTRATION_ENABLED=0"
      echo "COMPOSE_FILE=docker-compose.yml"
      echo "EDGE_NETWORK=edge_proxy"
    } > "$ENV_FILE.tmp"
    mv "$ENV_FILE.tmp" "$ENV_FILE"
  )
  chmod 600 "$ENV_FILE"
  log ".env oluşturuldu (600). JWT_SECRET ve MFA_ENCRYPTION_KEY'i sunucu dışında güvenli yere yedekleyin."
fi

step "3/9 Ön kontrol (kapasite, yalıtım, sır biçimi)"
if [[ "${SKIP_PREFLIGHT:-0}" == "1" ]]; then log "UYARI ön kontrol atlandı (yalnızca yerel deneme)"; else "$PROD_DIR/preflight.sh" || die "Ön kontrol başarısız; kurulum durduruldu"; fi

wait_healthy() { # wait_healthy <konteyner> <sn>
  local c="$1" t="${2:-180}" s
  for ((i = 0; i < t; i += 5)); do
    s=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$c" 2>/dev/null || echo yok)
    [[ "$s" == healthy ]] && { log "$c sağlıklı"; return 0; }
    sleep 5
  done
  die "$c $t sn içinde sağlıklı olmadı (docker logs $c)"
}

step "4/9 PostgreSQL ve Redis"
"${COMPOSE[@]}" up -d postgres redis
wait_healthy proguzellik-prod-postgres
wait_healthy proguzellik-prod-redis

step "5/9 Migration (kontrollü, ayrı servis)"
"${COMPOSE[@]}" run --rm migrate
"$PROD_DIR/set-db-role-passwords.sh"

step "6/9 API, worker, web"
"${COMPOSE[@]}" up -d api worker web
wait_healthy proguzellik-prod-api
wait_healthy proguzellik-prod-worker
wait_healthy proguzellik-prod-web

step "7/9 Doğrulamalar"
owner=$(env_get PG_OWNER_USER); db=$(env_get PG_DB)
q() { docker exec -i proguzellik-prod-postgres psql -X -tA -U "$owner" -d "$db" -c "$1"; }
webjs() { docker exec proguzellik-prod-web node -e "$1"; }
check "Migration'lar güncel" "\"\${COMPOSE[@]}\" run --rm migrate node dist/cli/migrate.js status"
check "API hazır (/health/ready: iki DB rolü + Redis)" "webjs 'fetch(\"http://api:4000/health/ready\").then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))'"
check "Web /giris 200" "webjs 'fetch(\"http://127.0.0.1:3000/giris\").then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))'"
check "Herkese açık kayıt kapalı (API)" "webjs 'fetch(\"http://api:4000/auth/registration\").then(r=>r.json()).then(j=>process.exit(j.enabled===false?0:1)).catch(()=>process.exit(1))'"
check "Kayıt isteği 403 (veri oluşmaz)" "webjs 'fetch(\"http://127.0.0.1:3000/api/auth/register\",{method:\"POST\",headers:{\"content-type\":\"application/json\"},body:\"{}\"}).then(r=>process.exit(r.status===403?0:1)).catch(()=>process.exit(1))'"
check "/kayit sayfası kapalı mesajı" "webjs 'fetch(\"http://127.0.0.1:3000/kayit\").then(r=>r.text()).then(t=>process.exit(t.includes(\"registration-closed\")?0:1)).catch(()=>process.exit(1))'"
check "Demo/test verisi yok (kullanıcı ve işletme 0)" "[[ \$(q 'SELECT (SELECT count(*) FROM \"User\")+(SELECT count(*) FROM \"Tenant\")') == 0 ]]"
check "Paketler migration ile geldi (3)" "[[ \$(q 'SELECT count(*) FROM \"Plan\"') == 3 ]]"
check "API'de migration sahibi (DATABASE_URL) yok" "! docker exec proguzellik-prod-api sh -c 'env | grep -q ^DATABASE_URL='"
check "Entegrasyonlar pasif (e-posta/WhatsApp/ödeme/AI = mock)" "[[ \$(docker exec proguzellik-prod-api sh -c 'echo \$EMAIL_MODE\$WHATSAPP_MODE\$PAYMENT_MODE\$AI_MODE') == mockmockmockmock ]]"
check "API'nin internet çıkışı kapalı" "docker exec proguzellik-prod-api node -e 'fetch(\"https://example.com\",{signal:AbortSignal.timeout(4000)}).then(()=>process.exit(1)).catch(()=>process.exit(0))'"
check "Canlı yapılandırma denetimi (env:check)" "docker exec proguzellik-prod-api node dist/cli/check-env.js"
for c in api worker web postgres redis; do
  check "$c: host'a port yayını yok" "[[ -z \$(docker port proguzellik-prod-$c) ]]"
  check "$c: yalnızca proguzellik_prod_internal ağında" "[[ \$(docker inspect -f '{{range \$k,\$v := .NetworkSettings.Networks}}{{\$k}} {{end}}' proguzellik-prod-$c) == 'proguzellik_prod_internal ' ]]"
done

step "8/9 Yedek, geri yükleme doğrulaması, imaj arşivi"
backup_file=$("$PROD_DIR/backup.sh" | tail -1)
check "Yedek alındı: $(basename "$backup_file")" "[[ -s '$backup_file' ]]"
check "Yedek geçici veritabanına yüklenip doğrulandı" "PG_CONTAINER=proguzellik-prod-postgres PGUSER='$owner' DB_NAME='$db' BACKUP_DIR='$BACKUP_DIR' '$PROD_DIR/../scripts/verify-backup.sh' '$backup_file'"
"$PROD_DIR/archive-image.sh" "$V"
check "Geri dönüş arşivi mevcut ve özeti doğru" "(cd '$IMAGE_DIR' && sha -c 'proguzellik-$V.tar.gz.sha256')"

step "9/9 Özet"
"${COMPOSE[@]}" ps --format '{{.Name}}  {{.Status}}'
docker stats --no-stream --format '{{.Name}}  {{.MemUsage}}  {{.CPUPerc}}' $(docker ps --filter name=proguzellik-prod- -q)
df -h / | tail -1
du -sh "$BACKUP_DIR" "$IMAGE_DIR" 2>/dev/null
(( fail == 0 )) && log "KURULUM TAMAM: tüm doğrulamalar geçti. DNS/Caddy adımı YAPILMADI." || die "Bazı doğrulamalar başarısız (yukarıda HATA satırları)"
