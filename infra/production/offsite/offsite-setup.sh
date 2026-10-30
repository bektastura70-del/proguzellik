#!/usr/bin/env bash
# Sunucu dışı yedek (Google Drive) kurulumu — Mac'ten, TÜNELLE ve ETKİLEŞİMLİ çalıştırılır:
#   ssh -t -L 53682:127.0.0.1:53682 <vps> 'bash /opt/proguzellik/infra/production/offsite/offsite-setup.sh'
# 1) rclone (Docker, sabit sürüm) Google girişi için bir bağlantı yazar; bağlantıyı Mac tarayıcısında açıp
#    Google hesabıyla izin verirsiniz. Google yönlendirmesi tünel üzerinden sunucudaki rclone'a gelir.
#    Kapsam: drive.file (yalnız rclone'un oluşturduğu dosyalar). Token ekrana/loga yazılmaz; $OFF/rclone/rclone.conf (600).
# 2) Drive'da "ProGuzellikYedek" klasörü oluşturulur, kota raporlanır.
# 3) age anahtar çifti: ÖZEL anahtar yalnız bu terminalde BİR KEZ gösterilir ve sunucudan silinir; sunucuda yalnız açık anahtar kalır.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
source "$HERE/_offsite.sh"
die() { log "HATA: $*" >&2; exit 1; }
[[ $EUID -eq 0 ]] || die "root olarak çalıştırın"
[[ -t 0 ]] || die "etkileşimli terminal gerekli (ssh -t)"
command -v age >/dev/null && command -v age-keygen >/dev/null || die "age kurulu değil"
install -d -m 700 "$OFF" "$OFF/rclone"

log "1/4 rclone imajı: $RCLONE_IMAGE"
docker image inspect "$RCLONE_IMAGE" >/dev/null 2>&1 || docker pull -q "$RCLONE_IMAGE" >/dev/null

if [[ -s "$OFF/rclone/rclone.conf" ]]; then
  log "2/4 Google Drive bağlantısı zaten var; yeniden yetkilendirilmedi"
else
  log "2/4 Google girişi"
  W=$(mktemp -d -p /dev/shm gd.XXXXXX); chmod 700 "$W"
  trap 'find "$W" -type f -exec shred -u {} + 2>/dev/null; rm -rf "$W"' EXIT
  echo
  echo "Aşağıda http://127.0.0.1:53682/auth?state=... biçiminde bir bağlantı görünecek."
  echo "  - Bağlantıyı Mac tarayıcınızda açın (tünel sayesinde sunucudaki rclone a gider, oradan Google girişine yönlenir)"
  echo "  - bektastura70@gmail.com ile giriş yapın ve rclone'a izin verin"
  echo "  - Tarayıcıda 'Success' görünce buraya dönün"
  echo
  # Yalnız yetkilendirme için host ağı: rclone 127.0.0.1:53682'yi dinler (tünel bu porta gelir). Token stdout'a, dosyaya gider.
  docker run --rm --network host "$RCLONE_IMAGE" authorize drive eyJzY29wZSI6ImRyaXZlLmZpbGUifQ --auth-no-open-browser 2>&1 \
    | python3 -I -u -c '
import sys
out = open(sys.argv[1], "w"); hide = False
for line in sys.stdin:
    if "--->" in line:
        hide = True; out.write(line); print("(token alındı; gösterilmiyor)", flush=True); continue
    if hide:
        out.write(line)
        if "<---" in line: hide = False
        continue
    print(line, end="", flush=True)
' "$W/out"
  [[ ${PIPESTATUS[0]} -eq 0 ]] || die "Google yetkilendirmesi tamamlanmadı"
  python3 -I - "$W/out" "$OFF/rclone/rclone.conf" <<'PY'
import base64, json, os, re, sys
# rclone, işaretler arasına ya düz JSON token ya da (base64 seçenekle çağrıldığında) base64 kodlu
# {"token": "<json>"} yazar. İkisi de desteklenir; hata durumunda yalnız alan ADLARI yazılır, değerler asla.
txt = open(sys.argv[1]).read()
m = re.search(r"--->(.*?)<---", txt, re.S)
if not m:
    sys.exit("HATA: token işaretleri çıktıda bulunamadı")
blob = "".join(m.group(1).split())
def parse(s):
    if s.startswith("{"):
        return json.loads(s)
    return json.loads(base64.urlsafe_b64decode(s + "=" * (-len(s) % 4)).decode())
def find_token(d, depth=0):
    if isinstance(d, str):
        try:
            d = json.loads(d)
        except ValueError:
            return None
    if not isinstance(d, dict) or depth > 3:
        return None
    if "access_token" in d:
        return d
    for v in d.values():
        t = find_token(v, depth + 1)
        if t:
            return t
    return None
try:
    data = parse(blob)
except Exception:
    sys.exit("HATA: token çözülemedi (biçim: %d karakter, ilk karakter türü %s)" % (len(blob), "json" if blob[:1] == "{" else "base64?"))
tok = find_token(data)
if not tok:
    sys.exit("HATA: access_token bulunamadı; gelen alanlar: %s" % (sorted(data) if isinstance(data, dict) else type(data).__name__))
if "refresh_token" not in tok:
    sys.exit("HATA: refresh_token yok; alanlar: %s" % sorted(tok))
conf = "[gdrive]\ntype = drive\nscope = drive.file\ntoken = " + json.dumps(tok, separators=(",", ":")) + "\n"
tmp = sys.argv[2] + ".tmp"
fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
with os.fdopen(fd, "w") as f:
    f.write(conf)
os.replace(tmp, sys.argv[2])
print("token kaydedildi (gösterilmedi)")
PY
  chmod 600 "$OFF/rclone/rclone.conf"
fi

log "3/4 Drive klasörü ve kota"
rc mkdir "$REMOTE" >/dev/null 2>&1 || die "Drive'a yazılamadı (yetki?)"
rc about gdrive: --json 2>/dev/null | python3 -I -c '
import sys, json
try:
    a = json.load(sys.stdin); g = 1024 ** 3
    print("  Kota: toplam %.1f GB, kullanılan %.1f GB, boş %.1f GB" % (a.get("total", 0) / g, a.get("used", 0) / g, a.get("free", 0) / g))
except Exception:
    print("  Kota okunamadı (drive.file kapsamında gösterilmeyebilir)")
' || true
log "Klasör hazır: ProGuzellikYedek (yalnız rclone bu klasörü görür)"

log "4/4 Şifreleme anahtarı (age)"
if [[ -s "$OFF/age-recipient.txt" ]]; then
  log "Açık anahtar zaten var; yeni anahtar üretilmedi"
else
  K=$(mktemp -u -p /dev/shm age.XXXXXX)
  trap 'shred -u "$K" 2>/dev/null || true' EXIT
  ( umask 077; age-keygen -o "$K" 2>/dev/null )
  age-keygen -y "$K" > "$OFF/age-recipient.txt"; chmod 644 "$OFF/age-recipient.txt"
  echo
  echo "================ ÖZEL ANAHTAR (yalnız bir kez gösterilir) ================"
  grep '^AGE-SECRET-KEY-' "$K"
  echo "=========================================================================="
  echo "Parola yöneticinize 'ProGüzellik Drive yedek anahtarı' olarak kaydedin."
  echo "Bu anahtar olmadan Drive'daki yedekler AÇILAMAZ. Sohbete yapıştırmayın."
  read -r -p "Kaydettiyseniz 'kaydettim' yazın: " ok
  [[ "$ok" == "kaydettim" ]] || { rm -f "$OFF/age-recipient.txt"; die "Onay yok; açık anahtar silindi, yeniden çalıştırın"; }
  shred -u "$K"; trap - EXIT
  clear 2>/dev/null || true
  log "Özel anahtar sunucudan silindi"
fi
[[ -f "$OFF/KVKK_ONAY" ]] && log "KVKK onayı: VAR" || log "KVKK onayı: YOK — gece görevi gerçek veriyi YÜKLEMEZ"
log "KURULUM TAMAM"
