#!/usr/bin/env bash
# Pro Güzellik: e4c0d2e → 7e991c0 (api + worker + web). Mobil uygulama desteği + mağaza incelemesi için demo salon. Migration YOK.
# İçerik:
#  - Web: uygulama içinde (ProGuzellikApp) satın alma/abonelik sayfaları gizli, yerel hatırlatmalar, "Salon değiştir",
#         /hesap-silme sayfası, müşteri hesabını uygulamadan silme kartı. Normal tarayıcıda görünüm değişmez (silme kartı hariç).
#  - API: müşteri hesabı silme (yeni e-posta koduyla), demo salon betiği, yalnızca demo salonda geçen inceleme girişi (varsayılan kapalı).
#  - Demo salon: /r/demo-salon (gerçek veri yok: örnek hizmet/personel, müşteri ve randevu yok). Uzun deneme süresi, ödeme yok.
# Gizli bilgiler (işletme parolası, inceleme kodu) EKRANA YAZILMAZ; yalnızca root'un okuyabildiği dosyaya yazılır:
#   /opt/proguzellik/demo-inceleme.txt  (chmod 600)
# Bu betik YALNIZCA Bektaş Tura'nın onayıyla çalıştırılır:
#   ssh -t prososyalmedya 'bash /opt/proguzellik/infra/production/deploy-app-7e991c0.sh'
# Ne yapmaz: satın alma / iyzico / Meta / yapay zekâ / Web Push / Caddy / DNS ayarlarına ve diğer projelere dokunmaz.
set -Eeuo pipefail
cd /opt/proguzellik/infra/production
OLD=e4c0d2e NEW=7e991c0
EXPECTED=""
DEMO_SLUG=demo-salon
REVIEW_EMAIL=demo-musteri@proguzellik.com
SECRET_FILE=/opt/proguzellik/demo-inceleme.txt
STAMP=$(date +%Y%m%d-%H%M%S)
env_get() { grep -E "^$1=" .env | tail -1 | cut -d= -f2- ; }
env_set() { if grep -qE "^$1=" .env; then sed -i "s|^$1=.*|$1=$2|" .env; else printf '%s=%s\n' "$1" "$2" >> .env; fi; }
log() { printf '\n[%s] %s\n' "$(date '+%H:%M:%S')" "$*"; }
fail() { printf '\n*** DURDU: %s ***\n' "$*" >&2; printf 'Geri almak için (yalnızca Claude ile konuştuktan sonra): cd /opt/proguzellik/infra/production && cp -p docker-compose.yml.bak-%s-%s docker-compose.yml 2>/dev/null; cp -p .env.bak-%s-%s .env 2>/dev/null; ./rollback.sh %s\n' "$STAMP" "$NEW" "$STAMP" "$NEW" "$OLD" >&2; exit 1; }
trap 'fail "satır $LINENO başarısız oldu"' ERR
owner=$(env_get PG_OWNER_USER); db=$(env_get PG_DB)
q() { docker exec -i proguzellik-prod-postgres psql -X -tA -U "${owner:-proguzellik_owner}" -d "${db:-proguzellik}" -c "$1"; }
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

log "1/11 Ön kontrol (çalışan: $OLD → yeni: $NEW)"
grep -q "^APP_VERSION=$OLD$" .env || fail "Çalışan sürüm $OLD değil ($(env_get APP_VERSION))"
docker image inspect proguzellik-api:$NEW proguzellik-web:$NEW >/dev/null || fail "Yeni imajlar sunucuda yok"
[[ -f docker-compose.yml.$NEW && -f docker-compose.yml.$OLD ]] || fail "docker-compose.yml.$NEW / .$OLD bulunamadı"
cmp -s docker-compose.yml docker-compose.yml.$OLD || fail "Sunucudaki docker-compose.yml $OLD sürümünden farklı (elle değişiklik?); üzerine yazılmadı"
grep -q 'REVIEW_LOGIN_CODE: ${REVIEW_LOGIN_CODE:-}' docker-compose.yml.$NEW || fail "Yeni compose dosyası beklenen sürüm değil"
[[ "$(env_get PWA_ENABLED)" == "1" ]] || fail "PWA_ENABLED=1 değil; müşteri portalı (uygulama) canlıda kapalı"
docker run --rm --entrypoint ls proguzellik-api:$NEW dist/cli/create-demo-salon.js >/dev/null || fail "Yeni imajda demo salon betiği yok"
existing=$(q "SELECT count(*) FROM \"Tenant\" WHERE slug = '$DEMO_SLUG'")
echo "Demo salon şu an: $([[ $existing == 0 ]] && echo 'yok (oluşturulacak)' || echo 'var (çoğaltılmaz)')"
PURCHASE_BEFORE=$(env_get PURCHASE_ENABLED); echo "Siteden satın alma ayarı: ${PURCHASE_BEFORE:-0} (değiştirilmeyecek) · AI_MODE: $(env_get AI_MODE) (değiştirilmeyecek)"

log "2/11 Yedek + geri yükleme testi (geçici veritabanına)"
RESTORE_TEST_WEEKDAY=$(date +%u) ./backup.sh
grep -q " OK " /opt/proguzellik/backups/last-status || fail "Yedek başarısız"
cat /opt/proguzellik/backups/last-status

log "3/11 Çalışan sürümün imajını arşivle"
./archive-image.sh "$OLD"

log "4/11 Ayar dosyalarını yedekle, compose dosyasını ve sürümü güncelle"
cp -p .env ".env.bak-$STAMP-$NEW"; chmod 600 ".env.bak-$STAMP-$NEW"
cp -p docker-compose.yml "docker-compose.yml.bak-$STAMP-$NEW"
cp docker-compose.yml.$NEW docker-compose.yml
undo() { cp -p "docker-compose.yml.bak-$STAMP-$NEW" docker-compose.yml; cp -p ".env.bak-$STAMP-$NEW" .env; }
sed -i "s/^APP_VERSION=.*/APP_VERSION=$NEW/" .env
chmod 600 .env

log "5/11 Bekleyen veritabanı değişiklikleri (hiçbiri beklenmez)"
status=$(docker compose run --rm migrate node dist/cli/migrate.js status 2>&1 || true)
echo "$status" | tail -4
pending=$(echo "$status" | { grep -oE '[0-9]{14}_[a-z0-9_]+' || true; } | sort -u | tr '\n' ' ')
[[ "$pending" == "$EXPECTED" ]] || { undo; fail "Bekleyen migration'lar beklenenden farklı ($pending); hiçbir şey değiştirilmedi (dosyalar eski hâline döndü)"; }

log "6/11 Ön denetim (preflight)"
./preflight.sh || { undo; fail "Ön denetim başarısız; hiçbir şey değiştirilmedi"; }

log "7/11 api/worker/web'i yeni sürümle başlat (inceleme girişi henüz KAPALI)"
docker compose run --rm migrate
docker compose up -d api worker web

log "8/11 Sağlık kontrolü (en fazla 3 dk)"
wait_healthy api worker web || { docker compose ps --format '{{.Name}} {{.Image}} {{.Status}}'; fail "Konteynerler 3 dakikada sağlıklı olmadı (docker compose logs --tail 50 api web worker)"; }
docker compose ps --format '{{.Name}} {{.Image}} {{.Status}}'
echo "Ana sayfa: $(curl -s -o /dev/null -w '%{http_code}' https://proguzellik.com/) (200 beklenir)"
echo "Hesap silme sayfası: $(curl -s -o /dev/null -w '%{http_code}' https://proguzellik.com/hesap-silme) (200 beklenir)"
echo "Uygulamadan ana sayfa: $(curl -s -o /dev/null -w '%{http_code} → %{redirect_url}' -A 'Mozilla/5.0 ProGuzellikApp/1.0.0' https://proguzellik.com/) (307 → /giris beklenir)"
echo "Uygulamadan fiyatlar: $(curl -s -o /dev/null -w '%{http_code} → %{redirect_url}' -A 'Mozilla/5.0 ProGuzellikApp/1.0.0' https://proguzellik.com/fiyatlar) (307 → /uygulamada-yok beklenir)"
echo "Tarayıcıdan fiyatlar: $(curl -s -o /dev/null -w '%{http_code}' https://proguzellik.com/fiyatlar) (200 beklenir, değişmedi)"
echo "Android/Apple bağlantı dosyaları: $(curl -s -o /dev/null -w '%{http_code}' https://proguzellik.com/.well-known/assetlinks.json) / $(curl -s -o /dev/null -w '%{http_code}' https://proguzellik.com/.well-known/apple-app-site-association) (mağaza hesapları açılana kadar 404 beklenir)"
st=$(docker exec proguzellik-prod-api node -e "fetch('http://localhost:4000/purchase/status').then(r=>r.text()).then(console.log).catch(()=>console.log('hata'))")
echo "Satın alma durumu: $st (yayından önceki gibi)"

log "9/11 Demo salon (gerçek veri yok; tekrar çalıştırmada çoğaltılmaz)"
umask 077
tmp=$(mktemp)
docker exec proguzellik-prod-api node dist/cli/create-demo-salon.js --slug "$DEMO_SLUG" > "$tmp" || { rm -f "$tmp"; fail "Demo salon oluşturulamadı (sürüm yayında, salon yok)"; }
grep -E '^(DURUM|SALON_ADRESI|ISLETME_EPOSTA)=' "$tmp"

log "10/11 Mağaza inceleme girişi (yalnızca $DEMO_SLUG, tek adres; kod ekrana yazılmaz)"
if [[ -z "$(env_get REVIEW_LOGIN_CODE)" ]]; then
  code=$(printf '%06d' $(( $(od -An -N4 -tu4 /dev/urandom | tr -d ' ') % 900000 + 100000 )))
  cp -p .env ".env.bak-$STAMP-$NEW-review"; chmod 600 ".env.bak-$STAMP-$NEW-review"
  [[ -z "$(tail -c1 .env)" ]] || echo >> .env   # son satır yeni satırla bitmiyorsa eklenen ayar öncekine yapışmasın
  env_set REVIEW_LOGIN_SLUG "$DEMO_SLUG"
  env_set REVIEW_LOGIN_EMAIL "$REVIEW_EMAIL"
  env_set REVIEW_LOGIN_CODE "$code"
  chmod 600 .env
  unset code
  echo "İnceleme girişi ayarlandı."
else
  echo "İnceleme girişi zaten ayarlı; değiştirilmedi."
fi
docker compose up -d api worker
wait_healthy api worker web || fail "İnceleme ayarından sonra konteynerler sağlıklı olmadı. Kapatmak için .env'den REVIEW_LOGIN_* satırlarını silip: docker compose up -d api worker"
[[ "$(docker exec proguzellik-prod-api printenv REVIEW_LOGIN_SLUG)" == "$DEMO_SLUG" ]] || fail "API inceleme ayarını almadı"

if grep -q '^ISLETME_PAROLA=' "$tmp" || [[ ! -f "$SECRET_FILE" ]]; then
  {
    echo "# Pro Güzellik mağaza incelemesi bilgileri ($(date '+%Y-%m-%d %H:%M')). GİZLİ: sohbete/e-postaya düz yazmayın."
    echo "# App Store Connect > App Review Information ve Google Play Console > App access bölümüne girilir."
    echo
    echo "MUSTERI_GIRISI: https://proguzellik.com/r/$DEMO_SLUG  (uygulamada salon kodu: $DEMO_SLUG)"
    echo "MUSTERI_EPOSTA=$(env_get REVIEW_LOGIN_EMAIL)"
    echo "MUSTERI_KODU=$(env_get REVIEW_LOGIN_CODE)   (e-posta gönderilmez; her girişte aynı kod)"
    echo
    echo "ISLETME_GIRISI: uygulamada 'İşletme girişi' (https://proguzellik.com/giris)"
    grep -E '^ISLETME_EPOSTA=' "$tmp"
    grep -E '^ISLETME_PAROLA=' "$tmp" || echo "ISLETME_PAROLA=(önceden üretildi; yenilemek için: docker exec proguzellik-prod-api node dist/cli/create-demo-salon.js --reset-password)"
  } > "$SECRET_FILE"
  chmod 600 "$SECRET_FILE"
  echo "Bilgiler yazıldı: $SECRET_FILE (yalnızca root okuyabilir; içeriği ekrana yazılmadı)"
else
  echo "Bilgi dosyası zaten var ve parola değişmedi: $SECRET_FILE"
fi
rm -f "$tmp"

log "11/11 Son kontrol"
echo "Demo salon sayfası: $(curl -s -o /dev/null -w '%{http_code}' https://proguzellik.com/r/$DEMO_SLUG) (200 beklenir)"
app=$(docker exec proguzellik-prod-api node -e "fetch('http://localhost:4000/public/salons/$DEMO_SLUG/app').then(r=>r.json()).then(j=>console.log(JSON.stringify(j.features))).catch(()=>console.log('hata'))")
echo "Demo salon özellikleri: $app (portal:true beklenir)"
echo "Demo salonda müşteri/randevu: $(q "SELECT (SELECT count(*) FROM \"Customer\" c JOIN \"Tenant\" t ON t.id=c.\"tenantId\" WHERE t.slug='$DEMO_SLUG') || ' / ' || (SELECT count(*) FROM \"Appointment\" a JOIN \"Tenant\" t ON t.id=a.\"tenantId\" WHERE t.slug='$DEMO_SLUG')") (0 / 0 beklenir)"
docker compose run --rm migrate node dist/cli/migrate.js status 2>&1 | tail -2
trap - ERR
log "TAMAM: $NEW çalışıyor, demo salon hazır."
cat <<EOT

Bilgileri yalnızca kendiniz görün (Claude'a göndermeyin):  ssh -t prososyalmedya 'cat $SECRET_FILE'
İnceleme girişini kapatmak: .env'den REVIEW_LOGIN_* satırlarını silip  docker compose up -d api worker
Geri dönüş: cp -p docker-compose.yml.bak-$STAMP-$NEW docker-compose.yml && cp -p .env.bak-$STAMP-$NEW .env && ./rollback.sh $OLD
Bu çıktıyı (bilgi dosyasının içeriği OLMADAN) Claude'a gönderin.
EOT
