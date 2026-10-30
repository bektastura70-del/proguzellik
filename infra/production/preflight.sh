#!/usr/bin/env bash
# SALT OKUNUR ön kontrol: kapasite, yalıtım ve gizli değer biçimi. Hiçbir şeyi değiştirmez.
# Kullanım: infra/production/preflight.sh      (çıkış kodu 0 = engel yok)
source "$(dirname "$0")/_lib.sh"
MIN_FREE_GB="${MIN_FREE_GB:-10}"
MAX_USED_PCT="${MAX_USED_PCT:-85}"
MIN_MEM_MB="${MIN_MEM_MB:-2048}"
fail=0
ok()   { log "OK    $*"; }
bad()  { log "ENGEL $*"; fail=1; }
warn() { log "UYARI $*"; }

# 1) Disk
root=$(docker info --format '{{.DockerRootDir}}' 2>/dev/null || echo /var/lib/docker)
[[ -d "$root" ]] || root=/
read -r used_pct free_gb < <(df -BG --output=pcent,avail "$root" | tail -1 | tr -d '%G' | awk '{print $1, $2}')
(( free_gb >= MIN_FREE_GB )) && ok "Boş disk ${free_gb} GB (en az ${MIN_FREE_GB})" || bad "Boş disk ${free_gb} GB < ${MIN_FREE_GB} GB"
(( used_pct <= MAX_USED_PCT )) && ok "Disk doluluğu %${used_pct} (en çok %${MAX_USED_PCT})" || bad "Disk doluluğu %${used_pct} > %${MAX_USED_PCT}"

# 2) Bellek (ProGüzellik sınırları toplamı ~1.9 GB)
avail=$(awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo)
(( avail >= MIN_MEM_MB )) && ok "Kullanılabilir bellek ${avail} MB" || bad "Kullanılabilir bellek ${avail} MB < ${MIN_MEM_MB} MB"
[[ -n "$(swapon --show 2>/dev/null)" ]] || warn "Swap yok: bellek taşmasında konteynerler öldürülebilir"

# 3) Yalıtım: ortak vekil ağı var, isim çakışması yok
edge=$(env_get EDGE_NETWORK 2>/dev/null || true); edge=${edge:-edge_proxy}
if [[ "$(env_get COMPOSE_FILE 2>/dev/null || true)" == *edge* ]]; then
  docker network inspect "$edge" >/dev/null 2>&1 && ok "Vekil ağı mevcut: $edge" || bad "Vekil ağı yok: $edge"
else
  ok "Ortak vekil ağına bağlanılmıyor (yalıtılmış kurulum)"
fi
for c in $(docker ps -a --format '{{.Names}}'); do
  if [[ "$c" == proguzellik-prod-* ]] && [[ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$c")" != "proguzellik-prod" ]]; then
    bad "Başka projeye ait konteyner adı çakışıyor: $c"
  fi
done
grep -qE '^\s+ports:' "$PROD_DIR"/docker-compose*.yml && bad "Compose dosyasında host'a yayınlanan port var" || ok "Host'a yayınlanan port yok"

# 4) .env: izin ve gizli değer biçimi (değerler yazdırılmaz)
if [[ -f "$ENV_FILE" ]]; then
  ( require_env_file ) && ok ".env izni uygun" || fail=1
  for k in PG_OWNER_PASSWORD APP_TENANT_DB_PASSWORD APP_PLATFORM_DB_PASSWORD REDIS_PASSWORD JWT_SECRET MFA_ENCRYPTION_KEY; do
    v=$(env_get "$k" || true)
    [[ "$v" =~ ^[0-9a-f]{64}$ ]] && ok "$k biçimi uygun" || bad "$k boş ya da 64 karakter hex değil (openssl rand -hex 32)"
  done
  [[ "$(env_get PUBLIC_URL)" == https://* ]] && ok "PUBLIC_URL https" || bad "PUBLIC_URL https ile başlamalı"
  if [[ "$(env_get EMAIL_MODE)" == "smtp" ]]; then
    [[ -n "$(env_get SMTP_URL)" ]] && ok "SMTP_URL tanımlı" || bad "EMAIL_MODE=smtp ama SMTP_URL boş"
    [[ "$(env_get COMPOSE_FILE)" == *docker-compose.egress.yml* ]] && ok "SMTP için çıkış ağı etkin" || bad "EMAIL_MODE=smtp ama COMPOSE_FILE'da docker-compose.egress.yml yok (api SMTP'ye ulaşamaz)"
  else
    warn "EMAIL_MODE=mock: davet, doğrulama ve parola sıfırlama e-postaları GÖNDERİLMEZ"
  fi
  [[ "$(env_get PRICING_PUBLIC)" == "1" ]] && warn "PRICING_PUBLIC=1: paket fiyatları sitede görünür ve satışta kullanılır (onaylı mı?)"
  if [[ "$(env_get REGISTRATION_ENABLED)" == "1" ]]; then
    [[ "$(env_get EMAIL_MODE)" == "smtp" ]] && warn "REGISTRATION_ENABLED=1: ücretsiz deneme kaydı açık" || bad "REGISTRATION_ENABLED=1 ama e-posta kapalı: başvurular doğrulanamaz"
  else
    ok "İşletme kaydı kapalı"
  fi
  [[ -n "$(env_get APP_VERSION)" ]] && ok "APP_VERSION tanımlı" || bad "APP_VERSION boş"
else
  bad ".env yok: $ENV_FILE"
fi

(( fail == 0 )) && log "Sonuç: engel yok." || log "Sonuç: ENGEL VAR, devam etmeyin."
exit $fail
