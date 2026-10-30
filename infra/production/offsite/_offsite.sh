#!/usr/bin/env bash
# Sunucu dışı yedek (Google Drive) ortak ayarları. rclone sunucuya kurulmaz; sabit sürümlü Docker imajıyla çalışır.
# Yetki: Google Drive "drive.file" kapsamı — rclone yalnızca KENDİ oluşturduğu dosya/klasörleri görebilir ve değiştirebilir;
# Drive'daki diğer dosyalarınıza erişemez.
OFF=/opt/proguzellik/offsite
RCLONE_IMAGE="rclone/rclone:1.68.2"
REMOTE="gdrive:ProGuzellikYedek"
log() { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }

# rc <rclone argümanları...>   (yapılandırma 600 izinli $OFF/rclone/rclone.conf; token ekrana yazılmaz)
# Yerel dosyalar konteynerde /data altında görünür: rc_data <dizin> <argümanlar...>
rc() { docker run --rm --network bridge -v "$OFF/rclone:/config/rclone" "$RCLONE_IMAGE" "$@" --drive-use-trash=true --retries 3 --low-level-retries 5 --stats 0; }
rc_data() { local d="$1"; shift; docker run --rm --network bridge -v "$OFF/rclone:/config/rclone" -v "$d:/data" "$RCLONE_IMAGE" "$@" --drive-use-trash=true --retries 3 --low-level-retries 5 --stats 0; }
