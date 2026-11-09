#!/usr/bin/env bash
# Pro Güzellik: siteden denemesiz doğrudan paket satın almayı AÇAR (PURCHASE_ENABLED=1).
# Sitedeki herkes onaylı fiyatı olan paketleri kartla (iyzico, GERÇEK ödeme) satın alabilir; işletme ödeme alınınca açılır.
# Deneme başvuru formu ve genel kayıt etkilenmez.
# Yalnızca Bektaş Tura'nın onayıyla çalıştırılır. Kullanım (sunucuda): bash /opt/proguzellik/infra/production/enable-purchase.sh
# Kapatmak için: bash /opt/proguzellik/infra/production/disable-purchase.sh
set -Eeuo pipefail
cd /opt/proguzellik/infra/production
STAMP=$(date +%Y%m%d-%H%M%S)
env_get() { grep -E "^$1=" .env | tail -1 | cut -d= -f2- ; }
log() { printf '\n[%s] %s\n' "$(date '+%H:%M:%S')" "$*"; }
restore() { cp -p ".env.bak-$STAMP-purchase" .env; printf '\n*** DURDU: %s — .env eski hâline döndü, API yeniden başlatılmadı ***\n' "$1" >&2; exit 1; }

log "1/4 Ön kontrol"
grep -q 'PURCHASE_ENABLED: ${PURCHASE_ENABLED:-0}' docker-compose.yml || { echo "Compose dosyası bu özelliği tanımıyor (87bafa1 dağıtımı yapıldı mı?)"; exit 1; }
[[ "$(env_get EMAIL_MODE)" == "smtp" ]] || { echo "EMAIL_MODE=smtp değil: satın alma e-postası doğrulanamaz; durdu"; exit 1; }
[[ "$(env_get PAYMENT_MODE)" == "iyzico" ]] || { echo "PAYMENT_MODE=iyzico değil; durdu"; exit 1; }
[[ "$(env_get IYZICO_PILOT_TENANTS)" == "*" ]] || { echo "iyzico tüm işletmelerde açık değil (IYZICO_PILOT_TENANTS != *); durdu"; exit 1; }
[[ "$(env_get PRICING_PUBLIC)" != "0" ]] || { echo "PRICING_PUBLIC=0 (fiyatlar gizli); durdu"; exit 1; }
echo "iyzico adresi: $(env_get IYZICO_BASE_URL) (https://api.iyzipay.com = GERÇEK ödeme)"
read -r -p "Siteden GERÇEK ödemeli satın almayı açmak için büyük harfle SATIN ALMA AC yazın: " ans
[[ "$ans" == "SATIN ALMA AC" ]] || { echo "Onay verilmedi; hiçbir şey değişmedi"; exit 1; }

log "2/4 .env yedeği ve bayrak"
cp -p .env ".env.bak-$STAMP-purchase"; chmod 600 ".env.bak-$STAMP-purchase"
sed -i '/^PURCHASE_ENABLED=/d' .env
echo "PURCHASE_ENABLED=1" >> .env
grep -E '^PURCHASE_ENABLED=' .env

log "3/4 Ön denetim (preflight)"
./preflight.sh || restore "preflight başarısız"

log "4/4 Yalnızca API'yi yeniden başlat ve sağlık kontrolü"
docker compose up -d --no-deps api
for i in $(seq 1 24); do
  h=$(docker inspect -f '{{.State.Health.Status}}' proguzellik-prod-api 2>/dev/null || echo yok)
  [[ "$h" == healthy ]] && break
  sleep 5
done
[[ "$h" == healthy ]] || { echo "API 2 dakikada sağlıklı olmadı: docker compose logs --tail 50 api. Kapatmak için: bash disable-purchase.sh"; exit 1; }
st=$(docker exec proguzellik-prod-api node -e "fetch('http://localhost:4000/purchase/status').then(r=>r.text()).then(console.log).catch(()=>console.log('hata'))")
reg=$(docker exec proguzellik-prod-api node -e "fetch('http://localhost:4000/auth/registration').then(r=>r.text()).then(console.log).catch(()=>console.log('hata'))")
echo "Satın alma durumu: $st ({\"enabled\":true} beklenir)"
echo "Kayıt/deneme durumu: $reg (enabled:false beklenir; deneme başvurusu eskisi gibi)"
code=$(curl -s https://proguzellik.com/fiyatlar | grep -c 'satın al' || true)
echo "Fiyatlar sayfasında 'satın al' bağlantısı: $code (0'dan büyük beklenir)"
log "TAMAM: siteden satın alma AÇIK. Kapatmak için: bash disable-purchase.sh. Bu çıktıyı Claude'a gönderin."
