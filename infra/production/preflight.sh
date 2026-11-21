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
  if [[ "$(env_get TRIAL_APPLICATIONS_ENABLED)" == "1" ]]; then
    [[ "$(env_get EMAIL_MODE)" == "smtp" ]] && warn "TRIAL_APPLICATIONS_ENABLED=1: sitede deneme başvuru formu açık" || bad "TRIAL_APPLICATIONS_ENABLED=1 ama e-posta kapalı: başvurular doğrulanamaz"
  fi
  if [[ "$(env_get REGISTRATION_ENABLED)" == "1" ]]; then
    [[ "$(env_get EMAIL_MODE)" == "smtp" ]] && warn "REGISTRATION_ENABLED=1: ücretsiz deneme kaydı açık" || bad "REGISTRATION_ENABLED=1 ama e-posta kapalı: başvurular doğrulanamaz"
  else
    ok "İşletme kaydı kapalı"
  fi
  # PWA V1.0
  if [[ "$(env_get PWA_ENABLED)" == "1" ]]; then
    warn "PWA_ENABLED=1: salon uygulaması SaaS sahibi panelinden işletme başına açılabilir"
    [[ "$(env_get EMAIL_MODE)" == "smtp" ]] || warn "PWA_ENABLED=1 ama e-posta kapalı: müşteri portalına giriş kodu gönderilemez (portal 503 döner)"
  else
    ok "PWA kapalı (tüm işletmelerde eski online randevu akışı)"
  fi
  if [[ "$(env_get WEB_PUSH_MODE)" == "live" ]]; then
    for k in VAPID_PUBLIC_KEY VAPID_PRIVATE_KEY VAPID_SUBJECT; do [[ -n "$(env_get "$k")" ]] && ok "$k tanımlı" || bad "WEB_PUSH_MODE=live ama $k boş"; done
    [[ "$(env_get COMPOSE_FILE)" == *docker-compose.egress.yml* ]] && ok "Push için çıkış ağı etkin" || bad "WEB_PUSH_MODE=live ama COMPOSE_FILE'da docker-compose.egress.yml yok (worker push servislerine ulaşamaz)"
  fi
  if [[ "$(env_get PURCHASE_ENABLED)" == "1" ]]; then
    warn "PURCHASE_ENABLED=1: siteden doğrudan paket satın alma açık (işletme ödeme alınınca açılır)"
    [[ "$(env_get EMAIL_MODE)" == "smtp" ]] || bad "PURCHASE_ENABLED=1 ama e-posta kapalı: satın alma doğrulanamaz"
    [[ "$(env_get PAYMENT_MODE)" == "iyzico" ]] || bad "PURCHASE_ENABLED=1 ama PAYMENT_MODE iyzico değil"
    [[ "$(env_get IYZICO_PILOT_TENANTS)" == "*" ]] || warn "PURCHASE_ENABLED=1 ama IYZICO_PILOT_TENANTS \"*\" değil: satın alma formu kapalı görünür"
  else
    ok "Siteden doğrudan satın alma kapalı"
  fi
  if [[ "$(env_get PAYMENT_MODE)" == "iyzico" ]]; then
    warn "PAYMENT_MODE=iyzico: online ödeme yalnız IYZICO_PILOT_TENANTS'taki işletmelerde açık"
    [[ -n "$(env_get IYZICO_API_KEY)" && -n "$(env_get IYZICO_SECRET_KEY)" ]] && ok "iyzico anahtarları tanımlı" || bad "PAYMENT_MODE=iyzico ama iyzico anahtarları boş"
    [[ -n "$(env_get IYZICO_PILOT_TENANTS)" ]] || warn "IYZICO_PILOT_TENANTS boş: hiçbir işletmede ödeme açılmaz"
    [[ "$(env_get COMPOSE_FILE)" == *docker-compose.egress.yml* ]] && ok "iyzico için çıkış ağı etkin" || bad "PAYMENT_MODE=iyzico ama COMPOSE_FILE'da docker-compose.egress.yml yok (api iyzico'ya ulaşamaz)"
  else
    ok "Online ödeme kapalı"
  fi
  if [[ "$(env_get META_MODE)" == "live" ]]; then
    warn "META_MODE=live: salonların bağlı WhatsApp/Instagram hesapları gerçek mesaj alır ve gönderir"
    [[ "$(env_get COMPOSE_FILE)" == *docker-compose.egress.yml* ]] && ok "Meta için çıkış ağı etkin" || bad "META_MODE=live ama COMPOSE_FILE'da docker-compose.egress.yml yok (api Meta'ya ulaşamaz)"
    [[ "$(env_get META_APP_SECRET)" =~ ^[0-9a-fA-F]{32}$ ]] && ok "Meta uygulama sırrı biçimi doğru" || bad "META_MODE=live ama META_APP_SECRET 32 haneli onaltılık değil"
    for k in META_APP_ID META_ES_CONFIG_ID META_WEBHOOK_VERIFY_TOKEN; do [[ -n "$(env_get $k)" ]] || bad "META_MODE=live ama $k boş"; done
    [[ -n "$(env_get META_IG_CONFIG_ID)" ]] && ok "Instagram'ı bağla açık (META_IG_CONFIG_ID tanımlı)" || ok "Instagram'ı bağla kapalı (META_IG_CONFIG_ID boş; elle kurulum çalışır)"
  else
    ok "Meta bağlantıları kapalı (mock)"
  fi
  case "$(env_get AI_MODE)" in
    openai)
      warn "AI_MODE=openai: müşteri mesajları OpenAI'a (ABD) gönderilir; yalnızca onay veren işletmelerde ve Akıllı pakette çalışır"
      [[ "$(env_get OPENAI_API_KEY)" =~ ^[A-Za-z0-9_-]{20,}$ ]] && ok "OpenAI anahtarı tanımlı" || bad "AI_MODE=openai ama OPENAI_API_KEY boş ya da geçersiz"
      [[ -n "$(env_get OPENAI_MODEL)" ]] && ok "OpenAI modeli: $(env_get OPENAI_MODEL)" || bad "AI_MODE=openai ama OPENAI_MODEL boş"
      [[ "$(env_get COMPOSE_FILE)" == *docker-compose.egress.yml* ]] && ok "OpenAI için çıkış ağı etkin" || bad "AI_MODE=openai ama COMPOSE_FILE'da docker-compose.egress.yml yok (api OpenAI'a ulaşamaz)" ;;
    anthropic)
      warn "AI_MODE=anthropic: müşteri mesajları Anthropic'e (ABD) gönderilir; yalnızca Anthropic'e onay veren işletmelerde ve Akıllı pakette çalışır (eski OpenAI onayları geçersiz)"
      [[ "$(env_get ANTHROPIC_API_KEY)" =~ ^sk-ant-[A-Za-z0-9_-]{20,}$ ]] && ok "Anthropic anahtarı tanımlı" || bad "AI_MODE=anthropic ama ANTHROPIC_API_KEY boş ya da geçersiz"
      [[ -n "$(env_get AI_MODEL)" ]] && ok "Yapay zekâ modeli: $(env_get AI_MODEL)" || bad "AI_MODE=anthropic ama AI_MODEL boş (varsayılan yok)"
      [[ "$(env_get COMPOSE_FILE)" == *docker-compose.egress.yml* ]] && ok "Anthropic için çıkış ağı etkin" || bad "AI_MODE=anthropic ama COMPOSE_FILE'da docker-compose.egress.yml yok (api Anthropic'e ulaşamaz)" ;;
    ""|mock) ok "Yapay zekâ yanıtı kapalı (mock)" ;;
    *) bad "AI_MODE=$(env_get AI_MODE) desteklenmiyor (mock | openai | anthropic)" ;;
  esac
  case "$(env_get AI_MODE)" in
    openai|anthropic)
      [[ -n "$(env_get AI_PILOT_TENANTS)" ]] && ok "Yapay zekâ pilot listesi: $(env_get AI_PILOT_TENANTS)" || warn "AI_PILOT_TENANTS boş: gerçek yapay zekâ HİÇBİR salonda yanıt vermez (mesajlar personele düşer)"
      [[ "$(env_get AI_MODE)" == openai && -z "$(env_get AI_PRICE_USD_PER_MTOK)" ]] && warn "AI_PRICE_USD_PER_MTOK boş: OpenAI maliyeti 0 kaydedilir, günlük maliyet sınırı çalışmaz" ;;
  esac
  case "$(env_get ASSISTANT_AI_MODE)" in
    anthropic)
      [[ -n "$(env_get AI_MODEL)" && "$(env_get ANTHROPIC_API_KEY)" =~ ^sk-ant- ]] && ok "Sorular asistanı: Anthropic ($(env_get AI_MODEL))" || bad "ASSISTANT_AI_MODE=anthropic ama ANTHROPIC_API_KEY veya AI_MODEL eksik" ;;
    ""|mock) ok "Sorular asistanı: yerel (mock)" ;;
    *) bad "ASSISTANT_AI_MODE=$(env_get ASSISTANT_AI_MODE) desteklenmiyor (mock | anthropic)" ;;
  esac
  case "$(env_get AI_QUOTA_MODE)" in
    ""|off) warn "AI_QUOTA_MODE=off: kullanım kaydedilir, hak düşülmez (maliyet tavanları yine çalışır)" ;;
    shadow) ok "AI_QUOTA_MODE=shadow: hak düşülür, yanıt kesilmez" ;;
    enforce) ok "AI_QUOTA_MODE=enforce: hak bitince yapay zekâ personele devreder" ;;
    *) bad "AI_QUOTA_MODE=$(env_get AI_QUOTA_MODE) desteklenmiyor (off | shadow | enforce)" ;;
  esac
  [[ "$(env_get AI_GLOBAL_PAUSE)" == 1 ]] && warn "AI_GLOBAL_PAUSE=1: tüm yapay zekâ yanıtları durduruldu"
  [[ "$(env_get AI_TOPUP_ENABLED)" == 1 ]] && warn "AI_TOPUP_ENABLED=1: yapay zekâ ek paketi satışta (gerçek ödeme; satış metinleri hukuki onaylı olmalı)"
  [[ -n "$(env_get APP_VERSION)" ]] && ok "APP_VERSION tanımlı" || bad "APP_VERSION boş"
else
  bad ".env yok: $ENV_FILE"
fi

(( fail == 0 )) && log "Sonuç: engel yok." || log "Sonuç: ENGEL VAR, devam etmeyin."
exit $fail
