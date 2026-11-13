#!/usr/bin/env bash
# Google Play için İMZALI .aab üretir (canlı site yapılandırmasıyla). Parola gizli sorulur, diske yazılmaz.
#   bash scripts/build-release.sh
# Çıktı: android/app/build/outputs/bundle/release/app-release.aab  → Play Console > Test > Dahili test'e yüklenir.
set -euo pipefail
cd "$(dirname "$0")/.."
[[ -f android/keystore.properties ]] || { echo "Önce: bash scripts/create-upload-key.sh"; exit 1; }
export JAVA_HOME="${JAVA_HOME:-$HOME/Android/jdk/Contents/Home}" ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/sdk}"
if [[ -z "${PG_UPLOAD_PASSWORD:-}" ]]; then
  read -rsp "Yükleme anahtarı parolası: " PG_UPLOAD_PASSWORD; echo
fi
export PG_UPLOAD_PASSWORD
unset PG_BASE   # mağaza derlemesi her zaman canlı siteye bağlanır
npm run sync >/dev/null
(cd android && ./gradlew -q clean bundleRelease)
unset PG_UPLOAD_PASSWORD
AAB=android/app/build/outputs/bundle/release/app-release.aab
"$JAVA_HOME/bin/jarsigner" -verify "$AAB" >/dev/null && echo "İmza doğrulandı."
grep -q '"proguzellik.com"' android/app/src/main/assets/capacitor.config.json || { echo "HATA: canlı site yapılandırması değil"; exit 1; }
echo "Sürüm: $(grep -E 'versionName|versionCode' android/app/build.gradle | tr -s ' ' | tr '\n' ' ')"
echo "Hazır: $(pwd)/$AAB"
