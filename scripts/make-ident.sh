#!/usr/bin/env bash
# Download a streaming-service ident from YouTube and encode it for the
# NuvioTV hero video slot (LG webOS: H.264 high, yuv420p, 1080p, no audio).
#
# Usage: ./scripts/make-ident.sh <youtube-url> <name> [start] [duration]
#   start    trim start in seconds (default 0)
#   duration clip length in seconds (default 5)
set -euo pipefail

URL="${1:?usage: make-ident.sh <youtube-url> <name> [start] [duration]}"
NAME="${2:?usage: make-ident.sh <youtube-url> <name> [start] [duration]}"
START="${3:-0}"
DURATION="${4:-5}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RAW="$(mktemp -d)/raw.mp4"
OUT="$ROOT/heroes/${NAME}-ident.mp4"
STILL="$ROOT/stills/${NAME}-ident.jpg"

yt-dlp -f "bv*[height<=1080][ext=mp4]/bv*[height<=1080]/bv*" \
  --merge-output-format mp4 -o "$RAW" "$URL"

ffmpeg -y -ss "$START" -t "$DURATION" -i "$RAW" \
  -c:v libx264 -profile:v high -level 4.1 -pix_fmt yuv420p \
  -vf "scale=1920:-2" -crf 22 -preset slow \
  -an -movflags +faststart \
  "$OUT"

# Last frame as the loading still (heroBackdropUrl)
ffmpeg -y -sseof -0.1 -i "$OUT" -frames:v 1 -q:v 2 "$STILL"

echo
echo "Created:"
echo "  $OUT ($(du -h "$OUT" | cut -f1 | tr -d ' '))"
echo "  $STILL"
echo
echo "URLs after push:"
echo "  https://cdn.jsdelivr.net/gh/Corby7/nuvio-assets@main/heroes/${NAME}-ident.mp4"
echo "  https://cdn.jsdelivr.net/gh/Corby7/nuvio-assets@main/stills/${NAME}-ident.jpg"
