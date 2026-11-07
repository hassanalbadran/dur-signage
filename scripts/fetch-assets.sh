#!/usr/bin/env bash
# Downloads open-source fonts, icons and pdf.js into web/shared/assets (all free licenses: OFL / ISC / Apache-2.0).
# Runs automatically on Cloudflare Pages (build command) and in GitHub Actions. You can also run it locally.
set -u
cd "$(dirname "$0")/.."
A=web/shared/assets
mkdir -p $A/fonts

get() { # url dest
  [ -s "$2" ] && return 0
  curl -fsSL --retry 3 "$1" -o "$2" || { echo "WARN: failed $1"; rm -f "$2"; }
}

FS=https://cdn.jsdelivr.net/fontsource/fonts
for w in 400 500 700; do
  get $FS/ibm-plex-sans@latest/latin-$w-normal.woff2        $A/fonts/ibm-plex-sans-latin-$w.woff2
  get $FS/ibm-plex-sans-arabic@latest/arabic-$w-normal.woff2 $A/fonts/ibm-plex-sans-arabic-arabic-$w.woff2
done
for w in 400 700; do
  get $FS/cairo@latest/arabic-$w-normal.woff2    $A/fonts/cairo-arabic-$w.woff2
  get $FS/tajawal@latest/arabic-$w-normal.woff2  $A/fonts/tajawal-arabic-$w.woff2
  get $FS/amiri@latest/arabic-$w-normal.woff2    $A/fonts/amiri-arabic-$w.woff2
done

# pdf.js (legacy build works on old Android WebViews)
PV=3.11.174
get https://cdn.jsdelivr.net/npm/pdfjs-dist@$PV/legacy/build/pdf.min.js        $A/pdf.min.js
get https://cdn.jsdelivr.net/npm/pdfjs-dist@$PV/legacy/build/pdf.worker.min.js $A/pdf.worker.min.js

# Lucide icons (ISC license) -> icons.js  { name: "<inner svg markup>" }
ICONS="play pause plus trash-2 pencil monitor settings menu x upload film image type presentation repeat link unlink cloud check refresh-cw chevron-left chevron-right arrow-up arrow-down cloud-off folder hard-drive sun moon languages eye eye-off copy bold italic underline align-left align-center align-right heart-pulse square stop-circle file-text clock list-checks palette sparkles log-out info loader-circle monitor-play layers"
OUT=$A/icons.js
echo "window.ICONS={" > $OUT.tmp
for n in $ICONS; do
  svg=$(curl -fsSL --retry 3 "https://cdn.jsdelivr.net/npm/lucide-static@0.460.0/icons/$n.svg" 2>/dev/null) || continue
  inner=$(printf '%s' "$svg" | tr '\n' ' ' | sed -e 's/^.*<svg[^>]*>//' -e 's/<\/svg>.*$//' -e "s/'/\\\\'/g")
  echo "'$n':'$inner'," >> $OUT.tmp
done
echo "};" >> $OUT.tmp
mv $OUT.tmp $OUT
echo "assets ready: $(ls $A/fonts | wc -l) fonts, $(grep -c "':'" $OUT) icons"
