#!/usr/bin/env bash
# Pro Güzellik: adc5f39 → 6c80311 (api + worker + web). Bektaş Tura'nın onayıyla (21.11.2026: deploy + ai_quota migration;
# hukuki metinler zaten adc5f39 ile canlıda).
# İçerik:
#  - Yapay zekâ kullanım hakkı (salon panelinde yalnız yüzde barı), maliyet tavanları, SaaS sahibi Yapay zekâ sayfası,
#    günlük sınır e-postası, Finans raporunda "Yapay zekâ ek paket" sütunu. Ek paket SATIŞI KAPALI (AI_TOPUP_ENABLED=0).
#  - iyzico iade süreci (3fc2016), panel etiketleri, plan hatası 502 (d8f91b9).
#  - 1 migration (yalnız ekleme): 20261121150000_ai_quota. 5 yeni tablo (RLS), Plan.aiMonthlyCreditKurus (SMART=50000),
#    ChannelConnection.aiDataConsentProvider (mevcut onaylar 'openai'). Hiçbir sütun/satır silinmez.
#  - Compose DEĞİŞİYOR: api'ye yapay zekâ değişkenleri (güvenli varsayılanlar: ASSISTANT_AI_MODE=mock, AI_QUOTA_MODE=off,
#    AI_GLOBAL_PAUSE=0, AI_TOPUP_ENABLED=0).
#
# ÖNEMLİ (pilot listesi): yeni sürümde canlıda gerçek yapay zekâ YALNIZ AI_PILOT_TENANTS'taki salonlarda çalışır.
#   AI_PILOT=deneme  → .env'e AI_PILOT_TENANTS=deneme yazılır (ayrı onay gerekir), Deneme'de yanıtlar sürer.
#   AI_PILOT=yok     → .env'e dokunulmaz; AI_MODE=openai olsa da yapay zekâ HİÇBİR salonda yanıt vermez (mesajlar ekibe).
#   İkisi de verilmezse betik hiçbir şey değiştirmeden durur.
#
# Hazırlık (Mac'te, proje kökünde; imajlar yalnız apps/ içerir, 6c80311 sonrası commit'ler yalnız docs/infra):
#   V=6c80311
#   docker build --platform linux/amd64 -f apps/api/Dockerfile -t proguzellik-api:$V .
#   docker build --platform linux/amd64 -f apps/web/Dockerfile -t proguzellik-web:$V .
#   docker save proguzellik-api:$V proguzellik-web:$V | gzip -1 | ssh prososyalmedya 'gunzip | docker load'
#   scp infra/production/docker-compose.yml prososyalmedya:/opt/proguzellik/infra/production/docker-compose.yml.$V
#   scp infra/production/preflight.sh infra/production/deploy-app-$V.sh prososyalmedya:/opt/proguzellik/infra/production/
# Kullanım: ssh -t prososyalmedya 'AI_PILOT=deneme bash /opt/proguzellik/infra/production/deploy-app-6c80311.sh'
#
# Ne yapmaz: .env'de APP_VERSION ve (AI_PILOT verildiyse) AI_PILOT_TENANTS dışında hiçbir ayara dokunmaz (AI_MODE, kota
# modu, fiyat, iyzico, Meta, satın alma aynen kalır); Caddy/DNS'e ve diğer projelere dokunmaz. Yeni sürüm başladıktan sonra
# sağlık/duman testi başarısız olursa otomatik olarak $OLD'a döner (yeni tablolar kalır; eski sürüm onları okumaz).
set -Eeuo pipefail
cd /opt/proguzellik/infra/production
OLD=adc5f39 NEW=6c80311
EXPECTED="20261121150000_ai_quota "
STAMP=$(date +%Y%m%d-%H%M%S)
STARTED=0 MIGRATING=0
PILOT="${AI_PILOT:-}"
env_get() { grep -E "^$1=" .env | tail -1 | cut -d= -f2- ; }
log() { printf '\n[%s] %s\n' "$(date '+%H:%M:%S')" "$*"; }
undo() { cp -p "docker-compose.yml.bak-$STAMP-$NEW" docker-compose.yml; cp -p ".env.bak-$STAMP-$NEW" .env; }
fail() {
  trap - ERR
  printf '\n*** DURDU: %s ***\n' "$*" >&2
  if (( MIGRATING == 1 )); then
    printf '\nMigration YARIDA kalmış olabilir. Uygulama eski sürüme döndürülüyor; veritabanına otomatik dokunulmaz.\n' >&2
    printf 'Durumu Claude ile birlikte inceleyin. Gerekirse (ayrı onayla): yedekten geri yükleme (infra/scripts/restore.sh) +\n' >&2
    printf '  prisma migrate resolve --rolled-back 20261121150000_ai_quota (migrate.js bunu desteklemez; komutu Claude hazırlar)\n' >&2
    printf 'Son yedek: %s\n' "$(cat /opt/proguzellik/backups/last-status 2>/dev/null)" >&2
  fi
  if (( STARTED == 1 )); then
    printf '\nOtomatik geri dönüş: %s\n' "$OLD" >&2
    undo || true
    ./rollback.sh "$OLD" || printf 'Geri dönüş BAŞARISIZ; elle: cp -p docker-compose.yml.bak-%s-%s docker-compose.yml && cp -p .env.bak-%s-%s .env && ./rollback.sh %s\n' "$STAMP" "$NEW" "$STAMP" "$NEW" "$OLD" >&2
    docker compose ps --format '{{.Name}} {{.Image}} {{.Status}}' >&2 || true
  fi
  exit 1
}
trap 'fail "satır $LINENO başarısız oldu"' ERR
owner=$(env_get PG_OWNER_USER); db=$(env_get PG_DB)
q() { docker exec -i proguzellik-prod-postgres psql -X -tA -v ON_ERROR_STOP=1 -U "${owner:-proguzellik_owner}" -d "${db:-proguzellik}" -c "$1"; }
wait_healthy() {
  for i in $(seq 1 36); do
    bad=0
    for c in "$@"; do
      h=$(docker inspect -f '{{.State.Health.Status}}' "proguzellik-prod-$c" 2>/dev/null || echo yok)
      [[ "$h" == healthy ]] || bad=1
    done
    (( bad == 0 )) && return 0
    sleep 5
  done
  return 1
}
api_get() { docker exec proguzellik-prod-api node -e "fetch('http://localhost:4000$1').then(async r=>console.log(r.status+' '+(await r.text()))).catch(()=>console.log('hata'))"; }

log "1/11 Ön kontrol (çalışan: $OLD → yeni: $NEW)"
grep -q "^APP_VERSION=$OLD$" .env || fail "Çalışan sürüm $OLD değil ($(env_get APP_VERSION))"
docker image inspect proguzellik-api:$NEW proguzellik-web:$NEW >/dev/null || fail "Yeni imajlar sunucuda yok"
[[ -f docker-compose.yml.$NEW && -f docker-compose.yml.$OLD ]] || fail "docker-compose.yml.$NEW / .$OLD bulunamadı"
cmp -s docker-compose.yml docker-compose.yml.$OLD || fail "Sunucudaki docker-compose.yml $OLD sürümünden farklı (elle değişiklik?); üzerine yazılmadı"
grep -q 'AI_PILOT_TENANTS: ${AI_PILOT_TENANTS:-}' docker-compose.yml.$NEW || fail "docker-compose.yml.$NEW yeni yapay zekâ değişkenlerini içermiyor"
grep -q 'AI_TOPUP_ENABLED: ${AI_TOPUP_ENABLED:-0}' docker-compose.yml.$NEW || fail "docker-compose.yml.$NEW'de ek paket varsayılanı 0 değil"
grep -q 'AI_QUOTA_MODE: ${AI_QUOTA_MODE:-off}' docker-compose.yml.$NEW || fail "docker-compose.yml.$NEW'de kota varsayılanı off değil"
echo "Satın alma: $(env_get PURCHASE_ENABLED) · AI_MODE: $(env_get AI_MODE) · META_MODE: $(env_get META_MODE) · PAYMENT_MODE: $(env_get PAYMENT_MODE) (değiştirilmeyecek)"
echo "AI_PILOT_TENANTS (şu an): '$(env_get AI_PILOT_TENANTS)' · AI_QUOTA_MODE: '$(env_get AI_QUOTA_MODE)' · AI_TOPUP_ENABLED: '$(env_get AI_TOPUP_ENABLED)' · AI_PRICE_USD_PER_MTOK: $([[ -n "$(env_get AI_PRICE_USD_PER_MTOK)" ]] && echo VAR || echo yok)"
echo "Yapay zekâ otomatik yanıtı açık kanallar (salon · kanal · onay):"
q "SELECT t.slug || ' · ' || c.channel || ' · ' || CASE WHEN c.\"aiDataConsentAt\" IS NULL THEN 'onay yok' ELSE 'onaylı' END FROM \"ChannelConnection\" c JOIN \"Tenant\" t ON t.id = c.\"tenantId\" WHERE c.\"aiAutoReply\" ORDER BY 1" | sed 's/^/  /'
case "$PILOT" in
  yok) if [[ -z "$(env_get AI_PILOT_TENANTS)" ]]; then echo "AI_PILOT=yok: pilot listesi boş kalacak; yapay zekâ hiçbir salonda yanıt vermeyecek."; fi ;;
  "") fail "AI_PILOT verilmedi. AI_PILOT=deneme (onaylandıysa) ya da AI_PILOT=yok ile çalıştırın; hiçbir şey değiştirilmedi" ;;
  *) [[ "$PILOT" =~ ^[a-z0-9-]{2,60}(,[a-z0-9-]{2,60})*$ ]] || fail "AI_PILOT geçersiz: $PILOT (virgülle salon adresleri)"
     for s in ${PILOT//,/ }; do [[ "$(q "SELECT count(*) FROM \"Tenant\" WHERE slug = '$s'")" == 1 ]] || fail "AI_PILOT: '$s' adresli salon yok"; done
     [[ -z "$(env_get AI_PILOT_TENANTS)" ]] || fail ".env'de AI_PILOT_TENANTS zaten var ($(env_get AI_PILOT_TENANTS)); üzerine yazılmadı"
     sq="'"; list="$sq${PILOT//,/$sq,$sq}$sq"
     others=$(q "SELECT string_agg(DISTINCT t.slug, ', ') FROM \"ChannelConnection\" c JOIN \"Tenant\" t ON t.id = c.\"tenantId\" WHERE c.\"aiAutoReply\" AND c.\"aiDataConsentAt\" IS NOT NULL AND c.status = 'CONNECTED' AND t.slug NOT IN ($list)")
     [[ -z "$others" ]] || fail "Yapay zekâsı açık başka salon(lar) var: $others. Pilot listesine eklenmezse yanıtları durur; AI_PILOT'u birlikte kararlaştırın. Hiçbir şey değiştirilmedi"
     echo "AI_PILOT_TENANTS=$PILOT eklenecek (yapay zekâsı açık başka salon yok)" ;;
esac

log "2/11 Yedek + geri yükleme testi (geçici veritabanına)"
bout="/opt/proguzellik/backups/deploy-$STAMP-$NEW.log"
RESTORE_TEST_WEEKDAY=$(date +%u) ./backup.sh 2>&1 | tee "$bout"
grep -q " OK " /opt/proguzellik/backups/last-status || fail "Yedek başarısız"
cat /opt/proguzellik/backups/last-status
grep -q "Doğrulama başarılı" "$bout" || fail "Geri yükleme testi başarılı görünmüyor ($bout); migration'a geçilmedi"

log "3/11 Çalışan sürümün imajını arşivle"
./archive-image.sh "$OLD"

log "4/11 Ayar dosyalarını yedekle, compose dosyasını ve sürümü güncelle"
cp -p .env ".env.bak-$STAMP-$NEW"; chmod 600 ".env.bak-$STAMP-$NEW"
cp -p docker-compose.yml "docker-compose.yml.bak-$STAMP-$NEW"
cp docker-compose.yml.$NEW docker-compose.yml
sed -i "s/^APP_VERSION=.*/APP_VERSION=$NEW/" .env
[[ -n "$PILOT" && "$PILOT" != yok ]] && printf 'AI_PILOT_TENANTS=%s\n' "$PILOT" >> .env
chmod 600 .env
diff <(grep -vE '^(APP_VERSION|AI_PILOT_TENANTS)=' ".env.bak-$STAMP-$NEW") <(grep -vE '^(APP_VERSION|AI_PILOT_TENANTS)=' .env) >/dev/null || { undo; fail ".env'de izin verilenler dışında fark oluştu; geri alındı"; }

log "5/11 Bekleyen veritabanı değişiklikleri (yalnız $EXPECTED beklenir)"
status=$(docker compose run --rm migrate node dist/cli/migrate.js status 2>&1 || true)
echo "$status" | tail -4
pending=$(echo "$status" | { grep -oE '[0-9]{14}_[a-z0-9_]+' || true; } | sort -u | tr '\n' ' ')
[[ "$pending" == "$EXPECTED" ]] || { undo; fail "Bekleyen migration'lar beklenenden farklı ($pending); hiçbir şey değiştirilmedi (dosyalar eski hâline döndü)"; }

log "6/11 Ön denetim (preflight)"
./preflight.sh || { undo; fail "Ön denetim başarısız; hiçbir şey değiştirilmedi"; }

log "7/11 Migration uygula"
consented=$(q "SELECT count(*) FROM \"ChannelConnection\" WHERE \"aiDataConsentAt\" IS NOT NULL")
STARTED=1 MIGRATING=1
docker compose run --rm migrate
MIGRATING=0
for t in AiBillingSettings AiWallet AiCreditLedger AiUsageEvent AiCreditPurchase; do
  [[ "$(q "SELECT relrowsecurity FROM pg_class WHERE relname = '$t'")" == t || "$t" == AiBillingSettings ]] || fail "$t tablosu yok ya da RLS kapalı"
done
[[ "$(q "SELECT count(*) FROM pg_class WHERE relname = 'AiBillingSettings'")" == 1 ]] || fail "AiBillingSettings tablosu yok"
[[ "$(q "SELECT count(*) FROM \"AiBillingSettings\"")" == 0 ]] || fail "AiBillingSettings boş başlamalıydı"
[[ "$(q "SELECT \"aiMonthlyCreditKurus\" FROM \"Plan\" WHERE code = 'SMART'")" == 50000 ]] || fail "Akıllı paketin aylık hakkı 50000 değil"
[[ "$(q "SELECT count(*) FROM \"Plan\" WHERE code <> 'SMART' AND \"aiMonthlyCreditKurus\" <> 0")" == 0 ]] || fail "Akıllı dışı pakete yapay zekâ hakkı yazılmış"
[[ "$(q "SELECT count(*) FROM \"ChannelConnection\" WHERE \"aiDataConsentProvider\" = 'openai'")" == "$consented" ]] || fail "Onaylı kanal sayısı ($consented) ile 'openai' işaretli sayı eşleşmiyor"
[[ "$(q "SELECT count(*) FROM pg_trigger WHERE tgrelid = '\"AiCreditLedger\"'::regclass AND NOT tgisinternal")" -ge 1 ]] || fail "AiCreditLedger yalnız-ekleme tetikleyicisi yok"
echo "Migration tamam: 5 tablo, Akıllı aylık hakkı 50000, $consented onaylı kanal 'openai', defter tetikleyicisi var"

log "8/11 api/worker/web'i yeni sürümle başlat"
docker compose up -d api worker web

log "9/11 Sağlık kontrolü (en fazla 3 dk)"
wait_healthy api worker web || fail "Konteynerler 3 dakikada sağlıklı olmadı"
docker compose ps --format '{{.Name}} {{.Image}} {{.Status}}'
for c in api worker web; do
  img=$(docker inspect -f '{{.Config.Image}}' "proguzellik-prod-$c")
  [[ "$img" == *":$NEW" ]] || fail "$c konteyneri $NEW imajında değil ($img)"
done
for v in AI_QUOTA_MODE AI_TOPUP_ENABLED AI_GLOBAL_PAUSE ASSISTANT_AI_MODE AI_PILOT_TENANTS; do
  echo "api $v=$(docker exec proguzellik-prod-api printenv $v || true)"
done
[[ "$(docker exec proguzellik-prod-api printenv AI_TOPUP_ENABLED)" == 0 ]] || fail "Ek paket satışı kapalı değil"

log "10/11 Sayfalar ve uç noktalar"
for p in / /fiyatlar /kvkk /gizlilik-politikasi /on-bilgilendirme-formu /satin-al /salonlar /hesap-silme; do
  c=$(curl -s -o /dev/null -w '%{http_code}' "https://proguzellik.com$p" || echo hata)
  [[ "$c" == 200 ]] || fail "$p $c"
  echo "$p: 200"
done
for p in /ai-quota /ai-quota/topup /platform/ai /platform/ai/purchases; do
  r=$(api_get "$p"); [[ "$r" == 401* ]] || fail "$p girişsiz açık: ${r:0:200}"; echo "$p girişsiz: 401"
done
r=$(api_get /purchase/status); echo "Satın alma durumu: ${r:0:200}"
[[ "$r" == 200* ]] || fail "Satın alma durumu okunamadı"
echo "Ek paket sayfası (girişsiz): $(curl -s -o /dev/null -w '%{http_code}' https://proguzellik.com/panel/abonelik/ai-paket) (307 → /giris beklenir)"

log "11/11 Son durum"
docker compose run --rm migrate node dist/cli/migrate.js status 2>&1 | tail -2
docker compose logs --since 3m api 2>&1 | grep -iE "error|hata" | grep -v "Günlük sınır" | tail -5 || true
trap - ERR
log "TAMAM: $NEW çalışıyor (APP_VERSION=$(env_get APP_VERSION), AI_PILOT_TENANTS='$(env_get AI_PILOT_TENANTS)')."
echo "Pilot salonda bir test mesajı gönderin; yapay zekâ yanıtı ve AiUsageEvent kaydı Claude ile kontrol edilir."
echo "Geri dönüş: cd /opt/proguzellik/infra/production && cp -p docker-compose.yml.bak-$STAMP-$NEW docker-compose.yml && cp -p .env.bak-$STAMP-$NEW .env && ./rollback.sh $OLD"
echo "Bu çıktıyı Claude'a gönderin."
