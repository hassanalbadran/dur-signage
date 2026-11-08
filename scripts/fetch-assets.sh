#!/usr/bin/env bash
# Downloads open-source fonts and pdf.js into web/shared/assets (licenses: OFL / Apache-2.0).
# Runs in GitHub Actions and in the Cloudflare Pages build. Fails loudly if anything is missing.
set -euo pipefail
cd "$(dirname "$0")/.."

ASSETS=web/shared/assets
mkdir -p "$ASSETS/fonts"

fetch() { # url destination
  if [ -s "$2" ]; then return 0; fi
  curl -fsSL --retry 4 --retry-delay 2 "$1" -o "$2"
}

FONTSOURCE=https://cdn.jsdelivr.net/fontsource/fonts

# UI fonts: IBM Plex Sans (Latin) + IBM Plex Sans Arabic
for weight in 400 500 700; do
  fetch "$FONTSOURCE/ibm-plex-sans@latest/latin-$weight-normal.woff2"          "$ASSETS/fonts/ibm-plex-sans-latin-$weight.woff2"
  fetch "$FONTSOURCE/ibm-plex-sans-arabic@latest/arabic-$weight-normal.woff2"  "$ASSETS/fonts/ibm-plex-sans-arabic-arabic-$weight.woff2"
done

# Brand display fonts (visually matched to the logo wordmark): Cinzel (Latin) + Noto Kufi Arabic
fetch "$FONTSOURCE/cinzel@latest/latin-500-normal.woff2"            "$ASSETS/fonts/cinzel-latin-500.woff2"
fetch "$FONTSOURCE/cinzel@latest/latin-700-normal.woff2"            "$ASSETS/fonts/cinzel-latin-700.woff2"
fetch "$FONTSOURCE/noto-kufi-arabic@latest/arabic-300-normal.woff2" "$ASSETS/fonts/noto-kufi-arabic-300.woff2"
fetch "$FONTSOURCE/noto-kufi-arabic@latest/arabic-500-normal.woff2" "$ASSETS/fonts/noto-kufi-arabic-500.woff2"

# Text-slide fonts
for weight in 400 700; do
  fetch "$FONTSOURCE/cairo@latest/arabic-$weight-normal.woff2"   "$ASSETS/fonts/cairo-arabic-$weight.woff2"
  fetch "$FONTSOURCE/tajawal@latest/arabic-$weight-normal.woff2" "$ASSETS/fonts/tajawal-arabic-$weight.woff2"
  fetch "$FONTSOURCE/amiri@latest/arabic-$weight-normal.woff2"   "$ASSETS/fonts/amiri-arabic-$weight.woff2"
done

# pdf.js (legacy build works on old Android WebViews)
PDFJS=3.11.174
fetch "https://cdn.jsdelivr.net/npm/pdfjs-dist@$PDFJS/legacy/build/pdf.min.js"        "$ASSETS/pdf.min.js"
fetch "https://cdn.jsdelivr.net/npm/pdfjs-dist@$PDFJS/legacy/build/pdf.worker.min.js" "$ASSETS/pdf.worker.min.js"

# Verify: every file must exist and be larger than 1 KB
bad=0
for f in "$ASSETS"/fonts/*.woff2 "$ASSETS"/pdf.min.js "$ASSETS"/pdf.worker.min.js; do
  if [ ! -s "$f" ] || [ "$(stat -c%s "$f")" -lt 1024 ]; then
    echo "ERROR: bad asset $f"
    bad=1
  fi
done
[ "$bad" -eq 0 ] || exit 1

echo "assets ready: $(ls "$ASSETS/fonts" | wc -l) fonts + pdf.js"
