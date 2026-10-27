#!/usr/bin/env bash
# Bir sürümün imajlarını diske arşivler. Sunucudaki gece "docker image prune" geri dönüş imajını silebileceği için
# her dağıtımdan ÖNCE çalışan sürüm arşivlenir. Son 3 sürüm tutulur.
# Kullanım: archive-image.sh <sürüm>
source "$(dirname "$0")/_lib.sh"
v="${1:?Kullanım: archive-image.sh <sürüm>}"
[[ "$v" =~ ^[A-Za-z0-9._-]+$ ]] || die "Geçersiz sürüm adı"
mkdir -p "$IMAGE_DIR"; chmod 700 "$IMAGE_DIR"
out="$IMAGE_DIR/proguzellik-$v.tar.gz"
[[ -f "$out" ]] && { log "Zaten arşivli: $out"; exit 0; }
docker image inspect "proguzellik-api:$v" "proguzellik-web:$v" >/dev/null || die "İmajlar bulunamadı: $v"
docker save "proguzellik-api:$v" "proguzellik-web:$v" | gzip -1 > "$out.partial"
mv "$out.partial" "$out"
(cd "$IMAGE_DIR" && sha "$(basename "$out")" > "$(basename "$out").sha256")
log "Arşivlendi: $out ($(du -h "$out" | cut -f1))"
ls -1t "$IMAGE_DIR"/proguzellik-*.tar.gz | tail -n +4 | while read -r f; do rm -f "$f" "$f.sha256"; log "Eski arşiv silindi: $f"; done
