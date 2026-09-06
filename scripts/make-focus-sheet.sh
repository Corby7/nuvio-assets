#!/usr/bin/env bash
# Bake a collection-tile focus animation into ONE sprite sheet, for the native
# legacy app (nuvio-native-legacy). The web app plays heroes/<name>-ident.mp4 in
# a <video>; the native app cannot — its only mp4 path is a hardware plane
# BEHIND the GL surface (see src/video.h), which is a single instance, a bare
# rectangle, and one load round-trip per focus change. So the tile gets frames.
#
# Usage: ./scripts/make-focus-sheet.sh <name>...   (default: every ident)
#
# THE GEOMETRY IS FIXED, and each number is forced by something:
#
#   1920 wide   tex_get_width clamps every decode to NV_TEX_HERO_WIDTH_MAX
#               (tex_cache.c), and the whole sheet shares that one budget. A
#               wider sheet is downscaled to fit and every cell pays for it in
#               sharpness; the app's cell coordinates are normalised, so they
#               would still be correct, just softer.
#   8x8 cells   240x136 each (136, not the exact-16:9 135: scale rounds odd
#               dimensions down to even, which silently cost a row of pixels per
#               cell and put every cell off its grid). The tile draws at 360x203 (home.c widthOf/heightOf
#               ROW_CATALOGS), so this is 0.65x — soft on a still, invisible on a
#               moving brand ident, and it keeps the sheet at 1920x1080 = 8.3 MB
#               decoded, the same as one hero backdrop.
#   15 fps      what the packaged path already chose for this animation
#               (tools/import-collections.mjs), measured on the TV.
#   64 frames   8x8 at 15 fps = 4.2667 s.
#
# -stream_loop is what makes the count CONSTANT. The idents run 2.5 s to 16 s, so
# a fixed fps over each clip's own length would give a different frame count per
# service, and that count would then have to travel to the app somehow. Looping
# the source and cutting at 4.2667 s fills all 64 cells for every clip: long ones
# are truncated, short ones repeat. Either way the app hardcodes 8x8x67ms and no
# metadata has to reach it.
#
# crop, not pad: netflix is 1920x1012 and prime 1920x876. The tile draws its
# cover with object-fit: cover (GFX_CARD), so the animation has to fill the same
# box the same way or it would letterbox on focus only.
set -euo pipefail

COLS=8; ROWS=8; CELL_W=240; CELL_H=136; FPS=15
SPAN=$(echo "$COLS * $ROWS / $FPS" | bc -l)

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$ROOT/focus"

names=("$@")
if [ ${#names[@]} -eq 0 ]; then
  names=()
  for f in "$ROOT"/heroes/*-ident.mp4; do
    [ -e "$f" ] || continue
    n="$(basename "$f")"; names+=("${n%-ident.mp4}")
  done
fi

for NAME in "${names[@]}"; do
  IN="$ROOT/heroes/${NAME}-ident.mp4"
  OUT="$ROOT/focus/${NAME}-ident.jpg"
  if [ ! -f "$IN" ]; then echo "skip ${NAME}: no $IN" >&2; continue; fi
  ffmpeg -y -v error -stream_loop -1 -i "$IN" -t "$SPAN" \
    -vf "fps=${FPS},scale=${CELL_W}:${CELL_H}:force_original_aspect_ratio=increase,crop=${CELL_W}:${CELL_H},tile=${COLS}x${ROWS}" \
    -frames:v 1 -q:v 4 "$OUT"
  echo "  focus/${NAME}-ident.jpg  ($(du -h "$OUT" | cut -f1 | tr -d ' '))"
done
