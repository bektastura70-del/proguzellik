#!/usr/bin/env bash
# Pro Güzellik: yapay zekâ kullanım ölçümünü GÖLGE moda alır ve OpenAI fiyatını tanımlar. Bektaş Tura'nın ayrı onayıyla.
#  - AI_PRICE_USD_PER_MTOK=0.10,0.50,0.01,0  (USD / 1 milyon token: girdi, çıktı, önbellekten girdi, önbelleğe yazma)
#    Fiyat: Bektaş'ın 22.11.2026'da verdiği OpenAI model fiyatı (girdi $0,10, önbellekli girdi $0,01, çıktı $0,50).
#    OpenAI önbelleğe yazmayı ayrıca ücretlendirmediği için 4. değer 0.
#  - AI_QUOTA_MODE=shadow: salon panelinde yapay zekâ barı görünür ve yanıtlar oldukça düşer; yanıtlar ASLA kesilmez.
# Önkoşul: SaaS sahibi panelinde Yapay zekâ → Fiyatlandırma ayarları kaydedilmiş olmalı (yoksa betik hiçbir şey yapmadan durur).
#   Not: ayarlar kaydedildiği andan itibaren salon günlük $ sınırı ve konuşma token sınırı her modda uygulanır.
# Kullanım: scp infra/production/set-ai-shadow.sh prososyalmedya:/opt/proguzellik/infra/production/
#           ssh -t prososyalmedya 'bash /opt/proguzellik/infra/production/set-ai-shadow.sh'
# Ne yapmaz: bu iki satır dışında .env'e, compose'a, sürüme, veritabanına dokunmaz. Yalnız api ve worker yeniden oluşturulur.
# Geri alma: betiğin sonunda yazdığı komut (.env yedeği + api/worker yeniden oluşturma). Başarısızlıkta otomatik geri alır.
set -Eeuo pipefail
cd /opt/proguzellik/infra/production
PRICE="0.10,0.50,0.01,0"
STAMP=$(date +%Y%m%d-%H%M%S)
BAK=".env.bak-$STAMP-shadow"
CHANGED=0
env_get() { grep -E "^$1=" .env | tail -1 | cut -d= -f2- ; }
log() { printf '\n[%s] %s\n' "$(date '+%H:%M:%S')" "$*"; }
fail() {
  trap - ERR
  printf '\n*** DURDU: %s ***\n' "$*" >&2
  if (( CHANGED == 1 )); then
    printf 'Geri alınıyor: .env yedeği + api/worker\n' >&2
    cp -p "$BAK" .env && docker compose up -d api worker >&2 || printf 'Geri alma BAŞARISIZ; elle: cp -p %s .env && docker compose up -d api worker\n' "$BAK" >&2
  fi
  exit 1
}
trap 'fail "satır $LINENO başarısız oldu"' ERR
owner=$(env_get PG_OWNER_USER); db=$(env_get PG_DB)
q() { docker exec -i proguzellik-prod-postgres psql -X -tA -v ON_ERROR_STOP=1 -U "${owner:-proguzellik_owner}" -d "${db:-proguzellik}" -c "$1"; }
wait_healthy() {
  for i in $(seq 1 36); do
    bad=0
    for c in "$@"; do [[ "$(docker inspect -f '{{.State.Health.Status}}' "proguzellik-prod-$c" 2>/dev/null)" == healthy ]] || bad=1; done
    (( bad == 0 )) && return 0
    sleep 5
  done
  return 1
}

log "1/4 Ön kontrol"
echo "Sürüm: $(env_get APP_VERSION) · AI_MODE: $(env_get AI_MODE) · OPENAI_MODEL: $(env_get OPENAI_MODEL) · AI_PILOT_TENANTS: $(env_get AI_PILOT_TENANTS)"
echo "Şu an: AI_QUOTA_MODE='$(env_get AI_QUOTA_MODE)' · AI_PRICE_USD_PER_MTOK='$(env_get AI_PRICE_USD_PER_MTOK)'"
[[ "$(env_get AI_MODE)" == openai ]] || fail "AI_MODE openai değil; bu fiyat OpenAI içindir"
case "$(env_get AI_QUOTA_MODE)" in ""|off) ;; *) fail "AI_QUOTA_MODE zaten '$(env_get AI_QUOTA_MODE)'; değiştirilmedi" ;; esac
[[ -z "$(env_get AI_PRICE_USD_PER_MTOK)" ]] || fail "AI_PRICE_USD_PER_MTOK zaten tanımlı; üzerine yazılmadı"
row=$(q "SELECT \"usdTry\" || ' TL · ' || CASE WHEN \"fxAuto\" THEN 'TCMB otomatik' ELSE 'elle' END || ' · tampon ' || \"fxBuffer\" || ' · çarpan ' || markup || ' · günlük sınır \$' || \"tenantDailyMaxUsd\" FROM \"AiBillingSettings\" WHERE id = 1")
[[ -n "$row" ]] || fail "Fiyatlandırma ayarları girilmemiş. Önce SaaS sahibi panelinde Yapay zekâ → Fiyatlandırma ayarlarını kaydedin; hiçbir şey değiştirilmedi"
echo "Ayarlar: $row"
echo "TCMB son kur: $(q "SELECT \"forexSelling\" || ' (' || \"date\" || ')' FROM \"FxRate\" WHERE currency = 'USD' ORDER BY \"date\" DESC LIMIT 1")"

log "2/4 .env yedeği ve iki satır"
cp -p .env "$BAK"; chmod 600 "$BAK"
CHANGED=1
if grep -q '^AI_QUOTA_MODE=' .env; then sed -i 's/^AI_QUOTA_MODE=.*/AI_QUOTA_MODE=shadow/' .env; else echo 'AI_QUOTA_MODE=shadow' >> .env; fi
echo "AI_PRICE_USD_PER_MTOK=$PRICE" >> .env
chmod 600 .env
diff <(grep -vE '^(AI_QUOTA_MODE|AI_PRICE_USD_PER_MTOK)=' "$BAK") <(grep -vE '^(AI_QUOTA_MODE|AI_PRICE_USD_PER_MTOK)=' .env) >/dev/null || fail ".env'de bu iki satır dışında fark oluştu"
./preflight.sh || fail "Ön denetim başarısız"

log "3/4 api ve worker yeniden oluşturuluyor"
docker compose up -d api worker
wait_healthy api worker web || fail "Konteynerler 3 dakikada sağlıklı olmadı"
docker compose ps --format '{{.Name}} {{.Image}} {{.Status}}'

log "4/4 Doğrulama"
for c in api worker; do
  m=$(docker exec "proguzellik-prod-$c" printenv AI_QUOTA_MODE || true); p=$(docker exec "proguzellik-prod-$c" printenv AI_PRICE_USD_PER_MTOK || true)
  echo "$c: AI_QUOTA_MODE=$m AI_PRICE_USD_PER_MTOK=$p"
  [[ "$m" == shadow && "$p" == "$PRICE" ]] || fail "$c yeni ayarları almadı"
done
[[ "$(docker exec proguzellik-prod-api printenv AI_TOPUP_ENABLED)" == 0 ]] || fail "Ek paket satışı kapalı değil"
r=$(docker exec proguzellik-prod-api node -e "fetch('http://localhost:4000/ai-quota').then(r=>console.log(r.status)).catch(()=>console.log('hata'))")
[[ "$r" == 401 ]] || fail "/ai-quota beklenmedik yanıt: $r"
c=$(curl -s -o /dev/null -w '%{http_code}' https://proguzellik.com/ || echo hata); [[ "$c" == 200 ]] || fail "Ana sayfa $c"
trap - ERR
log "TAMAM: gölge mod açık, OpenAI fiyatı tanımlı."
echo "Salon panelinde (Akıllı paketteki salonlar) Kanallar ve Abonelik sayfalarında yapay zekâ barı görünür; yanıtlar kesilmez."
echo "Geri alma: cd /opt/proguzellik/infra/production && cp -p $BAK .env && docker compose up -d api worker"
echo "Bu çıktıyı Claude'a gönderin."
