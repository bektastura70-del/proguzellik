#!/usr/bin/env bash
# Sunucu dışı yedek (Backblaze B2) kurulumu — sunucuda, root, ETKİLEŞİMLİ: ssh -t <vps> 'bash /opt/proguzellik/infra/production/offsite/offsite-setup.sh'
# - B2 Application Key gizli istemle alınır, /opt/proguzellik/offsite/b2.env (600) dosyasına yazılır; ekrana/loga yazılmaz.
# - Hesap/bucket/izin/bölge/Object Lock kontrol edilir; sorun varsa hiçbir şey kaydedilmez.
# - age anahtar çifti üretilir: ÖZEL anahtar yalnızca bu terminalde BİR KEZ gösterilir ve sunucudan güvenle silinir;
#   sunucuda yalnız açık anahtar kalır (sunucu ele geçirilse bile buluttaki yedekler çözülemez).
set -euo pipefail
OFF=/opt/proguzellik/offsite
HERE="$(cd "$(dirname "$0")" && pwd)"
log() { printf '[%s] %s\n' "$(date '+%H:%M:%S')" "$*"; }
die() { log "HATA: $*" >&2; exit 1; }
[[ $EUID -eq 0 ]] || die "root olarak çalıştırın"
[[ -t 0 ]] || die "etkileşimli terminal gerekli (ssh -t)"
command -v age >/dev/null && command -v age-keygen >/dev/null || die "age kurulu değil"
install -d -m 700 "$OFF"

read -r -p "B2 bucket adı (yalnız ProGüzellik için açtığınız private bucket): " BUCKET
[[ "$BUCKET" =~ ^[A-Za-z0-9-]{6,63}$ ]] || die "Geçersiz bucket adı"
read -r -p "B2 keyID: " KEYID
read -r -s -p "B2 applicationKey (gizli): " APPKEY; echo
[[ -n "$KEYID" && -n "$APPKEY" ]] || die "Anahtar boş"

TMPENV=$(mktemp -p "$OFF" .b2env.XXXXXX); chmod 600 "$TMPENV"
trap 'shred -u "$TMPENV" 2>/dev/null || true' EXIT
printf 'B2_KEY_ID=%s\nB2_APP_KEY=%s\nB2_BUCKET=%s\nB2_LOCK_MODE=governance\n' "$KEYID" "$APPKEY" "$BUCKET" > "$TMPENV"
unset APPKEY

log "1/3 B2 hesabı ve bucket kontrol ediliyor"
set +e
REPORT=$(B2_ENV_FILE="$TMPENV" python3 -I "$HERE/b2.py" check); rc=$?
set -e
echo "$REPORT"
[[ $rc -eq 0 ]] || die "Kontrol başarısız; hiçbir şey kaydedilmedi"
mv "$TMPENV" "$OFF/b2.env"; chmod 600 "$OFF/b2.env"; trap - EXIT
echo "$REPORT" > "$OFF/b2-check.json"; chmod 600 "$OFF/b2-check.json"
log "b2.env kaydedildi (600)"

log "2/3 Şifreleme anahtarı (age)"
if [[ -s "$OFF/age-recipient.txt" ]]; then
  log "Açık anahtar zaten var; yeni anahtar üretilmedi: $(cat "$OFF/age-recipient.txt")"
else
  K=$(mktemp -p /dev/shm age.XXXXXX); chmod 600 "$K"
  trap 'shred -u "$K" 2>/dev/null || true' EXIT
  rm -f "$K"; age-keygen -o "$K" 2>/dev/null
  age-keygen -y "$K" > "$OFF/age-recipient.txt"; chmod 644 "$OFF/age-recipient.txt"
  echo
  echo "================ ÖZEL ANAHTAR (yalnız bir kez gösterilir) ================"
  grep '^AGE-SECRET-KEY-' "$K"
  echo "=========================================================================="
  echo "Bunu parola yöneticinize 'ProGüzellik B2 yedek anahtarı' olarak kaydedin."
  echo "Bu anahtar olmadan buluttaki yedekler AÇILAMAZ. Sohbete yapıştırmayın."
  read -r -p "Kaydettiyseniz 'kaydettim' yazın: " ok
  [[ "$ok" == "kaydettim" ]] || { rm -f "$OFF/age-recipient.txt"; die "Onay yok; açık anahtar silindi, yeniden çalıştırın"; }
  shred -u "$K"; trap - EXIT
  clear 2>/dev/null || true
  log "Özel anahtar sunucudan silindi; açık anahtar: $(cat "$OFF/age-recipient.txt")"
fi

log "3/3 Durum"
[[ -f "$OFF/KVKK_ONAY" ]] && log "KVKK onayı: VAR (gerçek yedekler yüklenecek)" || log "KVKK onayı: YOK — gece görevi gerçek veriyi YÜKLEMEZ, yalnız durum yazar"
log "KURULUM TAMAM. Test: bash $HERE/offsite-restore-test.sh --synthetic"
