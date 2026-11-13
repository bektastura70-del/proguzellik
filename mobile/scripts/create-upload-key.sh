#!/usr/bin/env bash
# Google Play YÜKLEME anahtarını bir kez üretir. Parolayı keytool gizli olarak sorar; hiçbir yere yazılmaz.
#   bash scripts/create-upload-key.sh
# Sonuç: ~/ProGuzellik-Anahtar/proguzellik-upload.jks (yalnızca sizin okuyabildiğiniz) + android/keystore.properties
# (yalnızca dosya yolu ve takma ad; parola yok, git'e girmez).
# ÖNEMLİ: .jks dosyasını ve parolasını şirketin güvenli bir yerine (parola yöneticisi + şifreli yedek) kopyalayın.
# Play App Signing açıkken kaybolursa Play Console'dan "yükleme anahtarını sıfırla" istenebilir, ama birkaç gün sürer.
set -euo pipefail
cd "$(dirname "$0")/.."
DIR="${KEY_DIR:-$HOME/ProGuzellik-Anahtar}"
KS="$DIR/proguzellik-upload.jks"
KT="${KEYTOOL:-$HOME/Android/jdk/Contents/Home/bin/keytool}"
[[ -x "$KT" ]] || KT=keytool
[[ -e "$KS" ]] && { echo "Anahtar zaten var: $KS (üzerine yazılmadı)"; exit 1; }
mkdir -p "$DIR"; chmod 700 "$DIR"
echo "Parolayı keytool soracak (en az 6 karakter; güçlü bir parola seçin ve parola yöneticisine kaydedin)."
"$KT" -genkeypair -keystore "$KS" -storetype PKCS12 -alias upload -keyalg RSA -keysize 4096 -validity 10000 \
  -dname "CN=Pro Guzellik, O=BEKTAS TURA REKLAM MEDYA VE BILGI TEKNOLOJILERI LTD STI, C=TR"
chmod 600 "$KS"
printf 'storeFile=%s\nkeyAlias=upload\n' "$KS" > android/keystore.properties
chmod 600 android/keystore.properties
echo
echo "Anahtar hazır: $KS"
echo "Şimdi bu dosyayı ve parolasını yedekleyin. Sonra: bash scripts/build-release.sh"
