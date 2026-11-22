#!/usr/bin/env bash
# Pro Güzellik: f0472fb → b12513b (api + worker + web) + yapay zekâ EK PAKET SATIŞINI AÇMA (gerçek iyzico tahsilatı).
# Bektaş Tura'nın ayrı onayıyla çalıştırılır.
# İçerik:
#  - Ek paket satış koşulları 1.0 (/yapay-zeka-ek-paket-kosullari; avukat onaylı taslak + Bektaş'ın 22.11 kararları):
#    cayma hakkı yok; 14 gün içinde talep edilirse kullanılmamış kısım iade; abonelik sürdükçe ek hak geçerli (12 ayda bir
#    uzar), iptal edilip 12 ay dolunca iadesiz silinir; Akıllı'dan çıkışta iade yok; fatura elle.
#  - Ödeme sayfasında koşullara bağlantı + ön bilgilendirme özeti; satış koşulları sürümü ai-ek-paket-1.0 kayda yazılır.
#  - Etki metni aşağı yuvarlanır: 300 TL (KDV dahil) ≈ aylık hakkın çeyreği, 600 ≈ yarısı, 1.200 ≈ 1 katı, 2.400 ≈ 2 katı.
#  - .env: AI_TOPUP_ENABLED=1 (yalnız bu satır ve APP_VERSION). Migration YOK. Compose değişmez.
#  - GERÇEK TAHSİLAT: Akıllı paketteki, iyzico pilotunda olan salonlar panelden kartla ek paket alabilir.
# Hazırlık (Mac'te, proje kökünde):
#   V=b12513b
#   docker build --platform linux/amd64 -f apps/api/Dockerfile -t proguzellik-api:$V .
#   docker build --platform linux/amd64 -f apps/web/Dockerfile -t proguzellik-web:$V .
#   docker save proguzellik-api:$V proguzellik-web:$V | gzip -1 | ssh prososyalmedya 'gunzip | docker load'
#   scp infra/production/docker-compose.yml prososyalmedya:/opt/proguzellik/infra/production/docker-compose.yml.$V
#   scp infra/production/deploy-app-$V.sh prososyalmedya:/opt/proguzellik/infra/production/
# Kullanım: ssh -t prososyalmedya 'bash /opt/proguzellik/infra/production/deploy-app-b12513b.sh'
# Ne yapmaz: APP_VERSION ve AI_TOPUP_ENABLED dışında .env'e, compose'a, veritabanına, Caddy/DNS'e dokunmaz. Sağlık/duman testi
# başarısız olursa .env ve sürüm otomatik olarak geri alınır ($OLD, satış kapalı).
# Acil kapatma (satışı durdur, sürüm aynı): sed -i 's/^AI_TOPUP_ENABLED=.*/AI_TOPUP_ENABLED=0/' .env && docker compose up -d api worker
set -Eeuo pipefail
cd /opt/proguzellik/infra/production
OLD=f0472fb NEW=b12513b
EXPECTED=""
STAMP=$(date +%Y%m%d-%H%M%S)
STARTED=0 MIGRATING=0
env_get() { grep -E "^$1=" .env | tail -1 | cut -d= -f2- ; }
log() { printf '\n[%s] %s\n' "$(date '+%H:%M:%S')" "$*"; }
undo() { cp -p "docker-compose.yml.bak-$STAMP-$NEW" docker-compose.yml; cp -p ".env.bak-$STAMP-$NEW" .env; }
fail() {
  trap - ERR
  printf '\n*** DURDU: %s ***\n' "$*" >&2
  if (( MIGRATING == 1 )); then
    printf '\nMigration YARIDA kalmış olabilir. Uygulama eski sürüme döndürülüyor; veritabanına otomatik dokunulmaz. Claude ile inceleyin.\n' >&2
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
tcmb() { docker exec "proguzellik-prod-$1" node -e "fetch('https://www.tcmb.gov.tr/kurlar/today.xml',{signal:AbortSignal.timeout(10000)}).then(async r=>{const t=await r.text();const m=/CurrencyCode=\"USD\"[\s\S]*?<ForexSelling>([^<]+)/.exec(t);console.log(r.status+' USD '+(m?m[1]:'yok'))}).catch(e=>console.log('hata '+e.name))"; }

log "1/10 Ön kontrol (çalışan: $OLD → yeni: $NEW)"
grep -q "^APP_VERSION=$OLD$" .env || fail "Çalışan sürüm $OLD değil ($(env_get APP_VERSION))"
docker image inspect proguzellik-api:$NEW proguzellik-web:$NEW >/dev/null || fail "Yeni imajlar sunucuda yok"
[[ -f docker-compose.yml.$NEW && -f docker-compose.yml.$OLD ]] || fail "docker-compose.yml.$NEW / .$OLD bulunamadı"
cmp -s docker-compose.yml docker-compose.yml.$OLD || fail "Sunucudaki docker-compose.yml $OLD sürümünden farklı (elle değişiklik?); üzerine yazılmadı"
cmp -s docker-compose.yml.$OLD docker-compose.yml.$NEW || fail "Compose dosyası bu yayında değişmemeliydi"
echo "AI_MODE: $(env_get AI_MODE) · AI_PILOT_TENANTS: $(env_get AI_PILOT_TENANTS) · AI_QUOTA_MODE: '$(env_get AI_QUOTA_MODE)' · AI_TOPUP_ENABLED: '$(env_get AI_TOPUP_ENABLED)' (değiştirilmeyecek)"
[[ "$(env_get AI_QUOTA_MODE)" == enforce ]] || fail "AI_QUOTA_MODE enforce değil ('$(env_get AI_QUOTA_MODE)'); hiçbir şey değiştirilmedi"
[[ "$(env_get AI_TOPUP_ENABLED)" == "" || "$(env_get AI_TOPUP_ENABLED)" == 0 ]] || fail "AI_TOPUP_ENABLED zaten açık"
[[ "$(env_get PAYMENT_MODE)" == iyzico ]] || fail "PAYMENT_MODE iyzico değil; ek paket tahsil edilemez"
[[ "$(env_get IYZICO_BASE_URL)" == https://api.iyzipay.com* ]] || fail "iyzico canlı adres değil ($(env_get IYZICO_BASE_URL))"
echo "iyzico: canlı · IYZICO_PILOT_TENANTS: $([[ "$(env_get IYZICO_PILOT_TENANTS)" == "*" ]] && echo 'tüm salonlar' || echo 'listeli salonlar')"
[[ "$(q "SELECT count(*) FROM \"AiBillingSettings\"")" == 1 ]] || fail "Fiyatlandırma ayarları yok"
echo "Ek paket oranı: $(q "SELECT \"creditRatio\" FROM \"AiBillingSettings\" WHERE id = 1") (0.500 beklenir)"
[[ "$(q "SELECT \"creditRatio\" = 0.5 FROM \"AiBillingSettings\" WHERE id = 1")" == t ]] || fail "Ek paket oranı 0,5 değil; onaylanan fiyat/etki tablosu geçersiz olur"
[[ "$(q "SELECT \"aiMonthlyCreditKurus\" FROM \"Plan\" WHERE code = 'SMART'")" == 50000 ]] || fail "Akıllı aylık hakkı 50000 değil; etki tablosu geçersiz olur"
echo "Bekleyen/başarısız ek paket alımları: $(q "SELECT count(*) FROM \"AiCreditPurchase\" WHERE environment = 'live'") canlı kayıt (0 beklenir)"

log "2/10 Yedek + geri yükleme testi (geçici veritabanına)"
bout="/opt/proguzellik/backups/deploy-$STAMP-$NEW.log"
RESTORE_TEST_WEEKDAY=$(date +%u) ./backup.sh 2>&1 | tee "$bout"
grep -q " OK " /opt/proguzellik/backups/last-status || fail "Yedek başarısız"
cat /opt/proguzellik/backups/last-status
grep -q "Doğrulama başarılı" "$bout" || fail "Geri yükleme testi başarılı görünmüyor ($bout); migration'a geçilmedi"

log "3/10 Çalışan sürümün imajını arşivle"
./archive-image.sh "$OLD"

log "4/10 Ayar dosyalarını yedekle, sürümü güncelle, ek paket satışını aç"
cp -p .env ".env.bak-$STAMP-$NEW"; chmod 600 ".env.bak-$STAMP-$NEW"
cp -p docker-compose.yml "docker-compose.yml.bak-$STAMP-$NEW"
sed -i "s/^APP_VERSION=.*/APP_VERSION=$NEW/" .env
if grep -q '^AI_TOPUP_ENABLED=' .env; then sed -i 's/^AI_TOPUP_ENABLED=.*/AI_TOPUP_ENABLED=1/' .env; else echo 'AI_TOPUP_ENABLED=1' >> .env; fi
chmod 600 .env
diff <(grep -vE '^(APP_VERSION|AI_TOPUP_ENABLED)=' ".env.bak-$STAMP-$NEW") <(grep -vE '^(APP_VERSION|AI_TOPUP_ENABLED)=' .env) >/dev/null || { undo; fail ".env'de izin verilenler dışında fark oluştu; geri alındı"; }
grep -q '^AI_TOPUP_ENABLED=1$' .env || { undo; fail "AI_TOPUP_ENABLED yazılamadı"; }

log "5/10 Bekleyen veritabanı değişiklikleri (hiç beklenmez)"
status=$(docker compose run --rm migrate node dist/cli/migrate.js status 2>&1 || true)
echo "$status" | tail -4
pending=$(echo "$status" | { grep -oE '[0-9]{14}_[a-z0-9_]+' || true; } | sort -u | tr '\n' ' ')
[[ "$pending" == "$EXPECTED" ]] || { undo; fail "Bekleyen migration'lar beklenenden farklı ($pending); hiçbir şey değiştirilmedi"; }

log "6/10 Ön denetim (preflight)"
./preflight.sh || { undo; fail "Ön denetim başarısız; hiçbir şey değiştirilmedi"; }

log "7/10 Migration yok"
STARTED=1

log "8/10 api/worker/web'i yeni sürümle başlat"
docker compose up -d api worker web

log "9/10 Sağlık kontrolü (en fazla 3 dk)"
wait_healthy api worker web || fail "Konteynerler 3 dakikada sağlıklı olmadı"
docker compose ps --format '{{.Name}} {{.Image}} {{.Status}}'
for c in api worker web; do
  img=$(docker inspect -f '{{.Config.Image}}' "proguzellik-prod-$c")
  [[ "$img" == *":$NEW" ]] || fail "$c konteyneri $NEW imajında değil ($img)"
done
for c in api worker; do
  t=$(docker exec "proguzellik-prod-$c" printenv AI_TOPUP_ENABLED || true); m=$(docker exec "proguzellik-prod-$c" printenv AI_QUOTA_MODE || true)
  echo "$c AI_TOPUP_ENABLED=$t AI_QUOTA_MODE=$m"
  [[ "$t" == 1 && "$m" == enforce ]] || fail "$c yeni ayarları almadı"
done

log "10/10 Duman testleri"
for p in / /fiyatlar /kvkk /salonlar /hesap-silme; do
  c=$(curl -s -o /dev/null -w '%{http_code}' "https://proguzellik.com$p" || echo hata)
  [[ "$c" == 200 ]] || fail "$p $c"
  echo "$p: 200"
done
b=$(curl -s https://proguzellik.com/yapay-zeka-ek-paket-kosullari)
grep -q "Yapay Zekâ Ek Paketi Satış Koşulları" <<<"$b" || fail "Ek paket satış koşulları sayfası açılmadı"
grep -q "cayma hakkı bulunmamaktadır" <<<"$b" || fail "Satış koşullarında cayma maddesi yok"
! grep -q "AVUKAT" <<<"$b" || fail "Satış koşullarında karar bekleyen madde kaldı"
curl -s https://proguzellik.com/sitemap.xml | grep -q 'yapay-zeka-ek-paket-kosullari' || fail "Site haritasında ek paket koşulları yok"
echo "/yapay-zeka-ek-paket-kosullari: 200, cayma maddesi var, bekleyen madde yok"
for p in /ai-quota /ai-quota/topup /platform/ai /platform/ai/purchases; do
  r=$(api_get "$p"); [[ "$r" == 401* ]] || fail "$p girişsiz açık: ${r:0:200}"; echo "$p girişsiz: 401"
done
trap - ERR
log "TAMAM: $NEW çalışıyor (APP_VERSION=$(env_get APP_VERSION))."
echo "Ek paket satışı AÇIK (gerçek tahsilat). İlk alımı küçük tutarla siz yapın; sonucu Claude ile kontrol edin."
echo "Acil kapatma (sürüm aynı kalır): cd /opt/proguzellik/infra/production && sed -i 's/^AI_TOPUP_ENABLED=.*/AI_TOPUP_ENABLED=0/' .env && docker compose up -d api worker"
echo "Geri dönüş: cd /opt/proguzellik/infra/production && cp -p docker-compose.yml.bak-$STAMP-$NEW docker-compose.yml && cp -p .env.bak-$STAMP-$NEW .env && ./rollback.sh $OLD"
echo "Bu çıktıyı Claude'a gönderin."
