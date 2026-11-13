#!/usr/bin/env bash
# Mağaza ekran görüntüsü altyapısı. Gerçek veri değil, canlı DEMO salon (/r/demo-salon) kullanılır.
#
# Android (emülatör veya USB'li telefon, uygulama yüklü olmalı):
#   scripts/screenshots.sh android            → store/google-play/ekran-goruntuleri/yeni/*.png
# iOS (Xcode simülatörü açık, uygulama yüklü olmalı):
#   scripts/screenshots.sh ios                → store/ios/ekran-goruntuleri/yeni/*.png
#
# Her ekran için uygulama derin bağlantıyla açılır, sayfa yüklenince görüntü alınır. Girişli ekranlar için önce
# uygulamada demo hesaplarla bir kez giriş yapın; oturum cihazda kalır.
# PAUSE=1 ile her görüntüden önce Enter beklenir: bu arada ekranda sekme seçebilir (ör. Randevularım, Paketlerim)
# veya ek ekran hazırlayabilirsiniz.
# Görüntüler kontrol edilmeden mağazaya yüklenmez (kişisel veri, yanlış ekran).
set -euo pipefail
cd "$(dirname "$0")/.."
platform="${1:?Kullanım: scripts/screenshots.sh android|ios}"
WAIT="${WAIT:-6}"
SCREENS=(
  "01-baslangic|proguzellik://home"
  "02-salon|proguzellik://r/demo-salon"
  "03-randevularim|proguzellik://r/demo-salon"
  "04-hesabim|proguzellik://r/demo-salon"
  "05-isletme-girisi|proguzellik://giris"
  "06-isletme-paneli|proguzellik://panel/bugun"
)
case "$platform" in
  android)
    ADB="${ANDROID_HOME:-$HOME/Android/sdk}/platform-tools/adb"
    out=store/google-play/ekran-goruntuleri/yeni; mkdir -p "$out"
    "$ADB" get-state >/dev/null
    for s in "${SCREENS[@]}"; do
      name="${s%%|*}"; url="${s#*|}"
      "$ADB" shell am start -W -a android.intent.action.VIEW -d "'$url'" com.proguzellik.app >/dev/null
      sleep "$WAIT"
      [[ "${PAUSE:-0}" == 1 ]] && read -rp "$name hazır olunca Enter: "
      "$ADB" exec-out screencap -p > "$out/$name.png"
      echo "$out/$name.png"
    done ;;
  ios)
    out=store/ios/ekran-goruntuleri/yeni; mkdir -p "$out"
    for s in "${SCREENS[@]}"; do
      name="${s%%|*}"; url="${s#*|}"
      xcrun simctl openurl booted "$url"
      sleep "$WAIT"
      [[ "${PAUSE:-0}" == 1 ]] && read -rp "$name hazır olunca Enter: "
      xcrun simctl io booted screenshot "$out/$name.png" >/dev/null
      echo "$out/$name.png"
    done ;;
  *) echo "android veya ios" >&2; exit 1 ;;
esac
