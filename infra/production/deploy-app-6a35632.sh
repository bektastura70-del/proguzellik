#!/usr/bin/env bash
# Pro Güzellik: 783d51e → 6a35632 (api + worker + web). Sitede kalan büyük harfli "14 Gün Ücretsiz Dene" metinleri 7 Gün. Migration YOK, veri değişikliği YOK.
# İçerik: yeni ücretsiz denemeler 7 gün (TRIAL_DAYS / DEFAULT_TRIAL_DAYS = 7), site/e-posta metinleri "7 gün",
#         SaaS sahibi formlarında varsayılan 7. Mevcut işletmelerin trialEndsAt değerleri DEĞİŞMEZ.
# Bu betik YALNIZCA Bektaş Tura'nın onayıyla çalıştırılır:
#   ssh -t prososyalmedya 'bash /opt/proguzellik/infra/production/deploy-app-6a35632.sh'
# Ne yapmaz: .env'de APP_VERSION dışında hiçbir ayara, satın alma / iyzico / Meta / yapay zekâ / Web Push / Caddy / DNS
# ayarlarına, veritabanı verisine ve diğer projelere dokunmaz.
# Sağlık/duman testi yeni sürüm başlatıldıktan sonra başarısız olursa otomatik olarak $OLD'a geri döner.
set -Eeuo pipefail
cd /opt/proguzellik/infra/production
OLD=783d51e NEW=6a35632
EXPECTED=""
STAMP=$(date +%Y%m%d-%H%M%S)
STARTED=0
T0=$(date -u '+%Y-%m-%d %H:%M:%S')   # yalnızca betik başlamadan önce var olan işletmeler karşılaştırılır
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
q() { docker exec -i proguzellik-prod-postgres psql -X -tA -U "${owner:-proguzellik_owner}" -d "${db:-proguzellik}" -c "$1"; }
trials() { q "SELECT count(*) || ' | ' || coalesce(min(\"trialEndsAt\")::text,'-') || ' | ' || coalesce(max(\"trialEndsAt\")::text,'-') || ' | ' || coalesce(md5(string_agg(id || ':' || \"trialEndsAt\"::text, ',' ORDER BY id)),'-') FROM \"Tenant\" WHERE status = 'TRIAL' AND \"createdAt\" < '$T0'"; }
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

log "1/9 Ön kontrol (çalışan: $OLD → yeni: $NEW)"
grep -q "^APP_VERSION=$OLD$" .env || fail "Çalışan sürüm $OLD değil ($(env_get APP_VERSION))"
docker image inspect proguzellik-api:$NEW proguzellik-web:$NEW >/dev/null || fail "Yeni imajlar sunucuda yok"
[[ -f docker-compose.yml.$NEW && -f docker-compose.yml.$OLD ]] || fail "docker-compose.yml.$NEW / .$OLD bulunamadı"
cmp -s docker-compose.yml docker-compose.yml.$OLD || fail "Sunucudaki docker-compose.yml $OLD sürümünden farklı (elle değişiklik?); üzerine yazılmadı"
cmp -s docker-compose.yml.$NEW docker-compose.yml.$OLD || fail "docker-compose.yml.$NEW beklenmedik şekilde $OLD'dan farklı"
TRIALS_BEFORE=$(trials)
echo "TRIAL işletmeler (sayı | en erken bitiş | en geç bitiş | özet): $TRIALS_BEFORE"
echo "Siteden satın alma: $(env_get PURCHASE_ENABLED) · AI_MODE: $(env_get AI_MODE) · PAYMENT_MODE: $(env_get PAYMENT_MODE) (değiştirilmeyecek)"

log "2/9 Yedek + geri yükleme testi (geçici veritabanına)"
RESTORE_TEST_WEEKDAY=$(date +%u) ./backup.sh
grep -q " OK " /opt/proguzellik/backups/last-status || fail "Yedek başarısız"
cat /opt/proguzellik/backups/last-status

log "3/9 Çalışan sürümün imajını arşivle"
./archive-image.sh "$OLD"

log "4/9 Ayar dosyalarını yedekle, compose dosyasını ve sürümü güncelle"
cp -p .env ".env.bak-$STAMP-$NEW"; chmod 600 ".env.bak-$STAMP-$NEW"
cp -p docker-compose.yml "docker-compose.yml.bak-$STAMP-$NEW"
cp docker-compose.yml.$NEW docker-compose.yml
sed -i "s/^APP_VERSION=.*/APP_VERSION=$NEW/" .env
chmod 600 .env
diff <(grep -v '^APP_VERSION=' ".env.bak-$STAMP-$NEW") <(grep -v '^APP_VERSION=' .env) >/dev/null || { undo; fail ".env'de APP_VERSION dışında fark oluştu; geri alındı"; }

log "5/9 Bekleyen veritabanı değişiklikleri (hiçbiri beklenmez)"
status=$(docker compose run --rm migrate node dist/cli/migrate.js status 2>&1 || true)
echo "$status" | tail -4
pending=$(echo "$status" | { grep -oE '[0-9]{14}_[a-z0-9_]+' || true; } | sort -u | tr '\n' ' ')
[[ "$pending" == "$EXPECTED" ]] || { undo; fail "Bekleyen migration'lar beklenenden farklı ($pending); hiçbir şey değiştirilmedi (dosyalar eski hâline döndü)"; }

log "6/9 Ön denetim (preflight)"
./preflight.sh || { undo; fail "Ön denetim başarısız; hiçbir şey değiştirilmedi"; }

log "7/9 api/worker/web'i yeni sürümle başlat"
STARTED=1
docker compose run --rm migrate
docker compose up -d api worker web

log "8/9 Sağlık kontrolü (en fazla 3 dk)"
wait_healthy api worker web || fail "Konteynerler 3 dakikada sağlıklı olmadı"
docker compose ps --format '{{.Name}} {{.Image}} {{.Status}}'
for c in api worker web; do
  img=$(docker inspect -f '{{.Config.Image}}' "proguzellik-prod-$c")
  [[ "$img" == *":$NEW" ]] || fail "$c konteyneri $NEW imajında değil ($img)"
done

log "9/9 Duman testleri"
for p in / /fiyatlar /ucretsiz-deneme /ozellikler /sss /hakkimizda /iletisim /kullanim-kosullari; do
  b=$(curl -s "https://proguzellik.com$p" -w '\n%{http_code}')
  c=$(tail -1 <<<"$b")
  [[ "$c" == 200 ]] || fail "$p $c"
  ! grep -qiE '14(<!-- -->)? ?g(ü|u|Ü|U)n' <<<"$b" || fail "$p sayfasında hâlâ '14 gün' var (büyük/küçük harf duyarsız)"
  echo "$p: 200, '14 gün' yok"
done
grep -q '7 Gün Ücretsiz Dene' <<<"$(curl -s https://proguzellik.com/)" || fail "Ana sayfada '7 Gün Ücretsiz Dene' yok"
echo "Ana sayfa butonu: '7 Gün Ücretsiz Dene'"
echo "Uygulamadan fiyatlar: $(curl -s -o /dev/null -w '%{http_code} → %{redirect_url}' -A 'Mozilla/5.0 ProGuzellikApp/1.0.0' https://proguzellik.com/fiyatlar) (307 → /uygulamada-yok beklenir)"
st=$(docker exec proguzellik-prod-api node -e "fetch('http://localhost:4000/purchase/status').then(r=>r.text()).then(console.log).catch(()=>console.log('hata'))")
echo "Satın alma durumu: $st (yayından önceki gibi)"
TRIALS_AFTER=$(trials)
echo "TRIAL işletmeler önce: $TRIALS_BEFORE"
echo "TRIAL işletmeler sonra: $TRIALS_AFTER"
[[ "$TRIALS_BEFORE" == "$TRIALS_AFTER" ]] || fail "TRIAL işletmelerin bitiş tarihleri değişti"
docker compose run --rm migrate node dist/cli/migrate.js status 2>&1 | tail -2
trap - ERR
log "TAMAM: $NEW çalışıyor (APP_VERSION=$(env_get APP_VERSION))."
echo "Geri dönüş: cd /opt/proguzellik/infra/production && cp -p docker-compose.yml.bak-$STAMP-$NEW docker-compose.yml && cp -p .env.bak-$STAMP-$NEW .env && ./rollback.sh $OLD"
