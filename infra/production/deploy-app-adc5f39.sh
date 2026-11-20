#!/usr/bin/env bash
# Pro Güzellik: 4296795 → adc5f39 (api + worker + web). Bektaş Tura'nın onayıyla (avukat metinleri gördü ve onayladı, 20.11.2026).
# İçerik:
#  - Hukuki metinler 1.1: KVKK ve Gizlilik'te OpenAI, Meta (kullanımda), iyzico; Anthropic çıkarıldı.
#  - Yeni sayfa /on-bilgilendirme-formu; ödeme sayfalarında doldurulmuş Ön Bilgilendirme özeti.
#  - Ödemede 3 ayrı ve sunucuda zorunlu onay (sözleşmeler, otomatik yenileme, anında ifa/cayma yok); denetim kaydına yazılır.
#  - Yıllık paket: dönem başından itibaren 14 gün içinde iptalde tam iade (metin; iade iyzico panelinden elle yapılır).
#  - Migration YOK. Compose dosyası değişmedi.
# Kullanım (Mac'ten): ssh -t prososyalmedya 'bash /opt/proguzellik/infra/production/deploy-app-adc5f39.sh'
# Ne yapmaz: .env'de APP_VERSION dışında hiçbir ayara, Caddy/DNS'e ve diğer projelere dokunmaz. Sağlık/duman testi
# başarısız olursa otomatik olarak $OLD'a döner.
set -Eeuo pipefail
cd /opt/proguzellik/infra/production
OLD=4296795 NEW=adc5f39
EXPECTED=""
STAMP=$(date +%Y%m%d-%H%M%S)
STARTED=0
env_get() { grep -E "^$1=" .env | tail -1 | cut -d= -f2- ; }
log() { printf '\n[%s] %s\n' "$(date '+%H:%M:%S')" "$*"; }
undo() { cp -p "docker-compose.yml.bak-$STAMP-$NEW" docker-compose.yml; cp -p ".env.bak-$STAMP-$NEW" .env; }
fail() {
  trap - ERR
  printf '\n*** DURDU: %s ***\n' "$*" >&2
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

log "1/10 Ön kontrol (çalışan: $OLD → yeni: $NEW)"
grep -q "^APP_VERSION=$OLD$" .env || fail "Çalışan sürüm $OLD değil ($(env_get APP_VERSION))"
docker image inspect proguzellik-api:$NEW proguzellik-web:$NEW >/dev/null || fail "Yeni imajlar sunucuda yok"
[[ -f docker-compose.yml.$NEW && -f docker-compose.yml.$OLD ]] || fail "docker-compose.yml.$NEW / .$OLD bulunamadı"
cmp -s docker-compose.yml docker-compose.yml.$OLD || fail "Sunucudaki docker-compose.yml $OLD sürümünden farklı (elle değişiklik?); üzerine yazılmadı"
cmp -s docker-compose.yml.$OLD docker-compose.yml.$NEW || fail "Compose dosyası bu yayında değişmemeliydi"
echo "Satın alma: $(env_get PURCHASE_ENABLED) · AI_MODE: $(env_get AI_MODE) · META_MODE: $(env_get META_MODE) · PAYMENT_MODE: $(env_get PAYMENT_MODE) (değiştirilmeyecek)"

log "2/10 Yedek + geri yükleme testi (geçici veritabanına)"
RESTORE_TEST_WEEKDAY=$(date +%u) ./backup.sh
grep -q " OK " /opt/proguzellik/backups/last-status || fail "Yedek başarısız"
cat /opt/proguzellik/backups/last-status
grep -qi "geri yükleme" /opt/proguzellik/backups/backup.log && tail -8 /opt/proguzellik/backups/backup.log | grep -iE "geri|restore|TAMAM" || true

log "3/10 Çalışan sürümün imajını arşivle"
./archive-image.sh "$OLD"

log "4/10 Ayar dosyalarını yedekle, compose dosyasını ve sürümü güncelle"
cp -p .env ".env.bak-$STAMP-$NEW"; chmod 600 ".env.bak-$STAMP-$NEW"
cp -p docker-compose.yml "docker-compose.yml.bak-$STAMP-$NEW"
cp docker-compose.yml.$NEW docker-compose.yml
sed -i "s/^APP_VERSION=.*/APP_VERSION=$NEW/" .env
chmod 600 .env
diff <(grep -v '^APP_VERSION=' ".env.bak-$STAMP-$NEW") <(grep -v '^APP_VERSION=' .env) >/dev/null || { undo; fail ".env'de APP_VERSION dışında fark oluştu; geri alındı"; }

log "5/10 Bekleyen veritabanı değişiklikleri (hiç beklenmez)"
status=$(docker compose run --rm migrate node dist/cli/migrate.js status 2>&1 || true)
echo "$status" | tail -4
pending=$(echo "$status" | { grep -oE '[0-9]{14}_[a-z0-9_]+' || true; } | sort -u | tr '\n' ' ')
[[ "$pending" == "$EXPECTED" ]] || { undo; fail "Bekleyen migration'lar beklenenden farklı ($pending); hiçbir şey değiştirilmedi (dosyalar eski hâline döndü)"; }

log "6/10 Ön denetim (preflight)"
./preflight.sh || { undo; fail "Ön denetim başarısız; hiçbir şey değiştirilmedi"; }

log "7/10 api/worker/web'i yeni sürümle başlat (migration yok)"
STARTED=1
docker compose up -d api worker web

log "8/10 Sağlık kontrolü (en fazla 3 dk)"
wait_healthy api worker web || fail "Konteynerler 3 dakikada sağlıklı olmadı"
docker compose ps --format '{{.Name}} {{.Image}} {{.Status}}'
for c in api worker web; do
  img=$(docker inspect -f '{{.Config.Image}}' "proguzellik-prod-$c")
  [[ "$img" == *":$NEW" ]] || fail "$c konteyneri $NEW imajında değil ($img)"
done

log "9/10 Hukuki sayfalar"
for p in / /fiyatlar /kvkk /gizlilik-politikasi /kullanim-kosullari /mesafeli-satis-sozlesmesi /teslimat-ve-iade-sartlari /on-bilgilendirme-formu /satin-al /salonlar /hesap-silme; do
  c=$(curl -s -o /dev/null -w '%{http_code}' "https://proguzellik.com$p" || echo hata)
  [[ "$c" == 200 ]] || fail "$p $c"
  echo "$p: 200"
done
for p in /kvkk /gizlilik-politikasi; do
  b=$(curl -s "https://proguzellik.com$p")
  grep -q OpenAI <<<"$b" || fail "$p OpenAI içermiyor"
  grep -q iyzico <<<"$b" || fail "$p iyzico içermiyor"
  ! grep -q Anthropic <<<"$b" || fail "$p hâlâ Anthropic içeriyor"
done
echo "/kvkk ve /gizlilik-politikasi: OpenAI ve iyzico var, Anthropic yok"
curl -s https://proguzellik.com/mesafeli-satis-sozlesmesi | grep -q '14 gün içinde' || fail "Mesafeli satış sözleşmesinde 14 gün iade maddesi yok"
curl -s https://proguzellik.com/fiyatlar | grep -q 'yearly-refund-note' || fail "/fiyatlar yıllık iade notu yok"
curl -s https://proguzellik.com/sitemap.xml | grep -q 'on-bilgilendirme-formu' || fail "Site haritasında Ön Bilgilendirme Formu yok"
echo "Mesafeli satış 14 gün maddesi, /fiyatlar notu ve site haritası tamam"

log "10/10 Ödeme uç noktası: yeni onaylar zorunlu (ödeme formu AÇILMAZ, yalnız doğrulama hatası beklenir)"
r=$(docker exec proguzellik-prod-api node -e "fetch('http://localhost:4000/purchase/checkout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:'x'.repeat(30),billing:{fullName:'Ad Soyad',identityNumber:'11111111111',gsmNumber:'05050000000',city:'Karaman',address:'Adres 12345'},acceptedTerms:true,termsVersion:'1.1'})}).then(async r=>console.log(r.status+' '+(await r.text()))).catch(()=>console.log('hata'))")
if [[ "$r" == 400* && "$r" == *"yenileme"* ]]; then echo "Onaysız ödeme isteği: 400 (otomatik yenileme onayı isteniyor)"
else echo "UYARI (geri dönüş yapılmadı): onaysız ödeme isteği beklenen 400 + yenileme hatasını vermedi: ${r:0:300}"; fi
r=$(api_get /purchase/status); echo "Satın alma durumu: $r"
[[ "$r" == 200* ]] || fail "Satın alma durumu okunamadı"
trap - ERR
log "TAMAM: $NEW çalışıyor (APP_VERSION=$(env_get APP_VERSION))."
echo "Geri dönüş: cd /opt/proguzellik/infra/production && cp -p docker-compose.yml.bak-$STAMP-$NEW docker-compose.yml && cp -p .env.bak-$STAMP-$NEW .env && ./rollback.sh $OLD"
echo "Bu çıktıyı Claude'a gönderin."
