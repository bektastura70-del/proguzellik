#!/usr/bin/env bash
# Buluttan geri yükleme testi — sunucuda, root, ETKİLEŞİMLİ: ssh -t <vps> 'bash .../offsite-restore-test.sh [--synthetic]'
#   --synthetic : önce offsite-backup.sh --synthetic ile şema dökümü (kişisel veri yok) yüklenir, sonra o test edilir
#   (seçeneksiz): proguzellik/db/ altındaki en yeni gerçek yedek test edilir (KVKK onayından sonra)
# Adımlar: B2'den indir → SHA-256 doğrula → age özel anahtarı gizli istemle al (/dev/shm, iş bitince shred) → çöz →
#   AĞSIZ, geçici, ayrı bir PostgreSQL konteynerine geri yükle → tablo/politika sayılarını kontrol et → konteyner ve dosyaları sil.
# Canlı veritabanına ve diğer projelere dokunmaz.
set -euo pipefail
OFF=/opt/proguzellik/offsite
HERE="$(cd "$(dirname "$0")" && pwd)"
log() { printf '[%s] %s\n' "$(date '+%H:%M:%S')" "$*"; }
die() { log "HATA: $*" >&2; exit 1; }
[[ $EUID -eq 0 ]] || die "root olarak çalıştırın"
[[ -t 0 ]] || die "etkileşimli terminal gerekli (ssh -t)"

SUB="db/"
if [[ "${1:-}" == "--synthetic" ]]; then
  log "Sentetik test yedeği (yalnız şema) yükleniyor"
  bash "$HERE/offsite-backup.sh" --synthetic || { tail -5 "$OFF/offsite.log"; die "test yüklemesi başarısız"; }
  tail -3 "$OFF/offsite.log"
  SUB="test/"
fi

C="proguzellik-restoretest-$(date +%s)"
W=$(mktemp -d -p /dev/shm prgrt.XXXXXX); chmod 700 "$W"
cleanup() { docker rm -f "$C" >/dev/null 2>&1 || true; find "$W" -type f -exec shred -u {} + 2>/dev/null; rm -rf "$W"; }
trap cleanup EXIT

META=$(python3 -I "$HERE/b2.py" latest "$SUB")
NAME=$(echo "$META" | jq -r .fileName); SHA=$(echo "$META" | jq -r .sha256)
log "İndiriliyor: $NAME"
python3 -I "$HERE/b2.py" download "$NAME" "$W/enc"
[[ "$(sha256sum "$W/enc" | cut -d' ' -f1)" == "$SHA" ]] || die "indirilen dosyanın SHA-256'sı uyuşmuyor"
log "İndirilen dosya SHA-256 doğrulandı"

read -r -s -p "age özel anahtarı (AGE-SECRET-KEY-...; gizli): " KEY; echo
[[ "$KEY" == AGE-SECRET-KEY-* ]] || die "anahtar biçimi beklenmedik"
umask 077; printf '%s\n' "$KEY" > "$W/key"; unset KEY
age -d -i "$W/key" -o "$W/dump" "$W/enc" || die "çözme başarısız (yanlış anahtar?)"
shred -u "$W/key"
log "Çözüldü ($(du -h "$W/dump" | cut -f1)); anahtar silindi"

log "Geçici, ağsız PostgreSQL başlatılıyor: $C"
docker run -d --rm --name "$C" --network none -e POSTGRES_PASSWORD="$(openssl rand -hex 16)" -e POSTGRES_USER=restoretest \
  --memory 384m postgres:16-alpine >/dev/null
for i in $(seq 1 30); do docker exec "$C" pg_isready -U restoretest >/dev/null 2>&1 && break; sleep 1; done
docker exec "$C" pg_isready -U restoretest >/dev/null
for r in proguzellik_owner app_tenant app_platform; do docker exec "$C" psql -q -U restoretest -d postgres -c "CREATE ROLE $r NOLOGIN" >/dev/null; done
docker exec "$C" psql -q -U restoretest -d postgres -c "CREATE DATABASE rt OWNER proguzellik_owner" >/dev/null
docker exec -i "$C" pg_restore -U restoretest -d rt --exit-on-error < "$W/dump"
q() { docker exec "$C" psql -X -tA -U restoretest -d rt -c "$1"; }
T=$(q "SELECT count(*) FROM pg_tables WHERE schemaname='public'")
P=$(q "SELECT count(*) FROM pg_policies")
RLS=$(q "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity")
log "Geri yüklendi: $T tablo, $P RLS politikası, RLS açık $RLS tablo"
(( T > 20 && P > 0 )) || die "geri yüklenen veritabanı beklenenden küçük"
log "GERİ YÜKLEME TESTİ BAŞARILI; geçici konteyner ve dosyalar siliniyor"
