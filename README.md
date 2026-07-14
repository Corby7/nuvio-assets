# nuvio-assets

Static media assets for my personal NuvioTV setup, served via jsDelivr.

## Layout

- `heroes/` — short looping H.264 MP4 idents used as collection hero videos (`heroVideoUrl`)
- `stills/` — matching still frames shown while the video loads (`heroBackdropUrl`)
- `logos/` — transparent PNG wordmarks used as collection title logos (`titleLogoUrl`),
  cropped tight to their alpha bounding box so they fill the 440x200 display box
  (`--modern-hero-logo-max-width/height`) instead of floating in a sea of transparent padding
- `covers/` — lossy WebP, 500px wide, used as collection folder cover art
  (`coverImageUrl`) on home-row tiles. Source covers (from postimg.cc and
  cdn.xperience-app.com) shipped at 1080-1920px wide but the tiles render at
  ~411px — decode cost scales with pixel count, not file size, so that was
  several times more pixels than needed and showed up as 60-180ms single-image
  decode stalls during vertical scroll on the C3. Resize+encode in one step:
  `cwebp -q 90 -resize 500 0 <in>.png -o covers/<name>-cover.webp` (decode a
  WebP source to PNG first with `dwebp <in>.webp -o <in>.png` — cwebp doesn't
  take WebP input).
- `scripts/make-ident.sh` — download → trim → encode → still-frame pipeline

## URL pattern

```
https://cdn.jsdelivr.net/gh/Corby7/nuvio-assets@main/heroes/<name>-ident.mp4
https://cdn.jsdelivr.net/gh/Corby7/nuvio-assets@main/stills/<name>-ident.jpg
https://cdn.jsdelivr.net/gh/Corby7/nuvio-assets@main/logos/<name>-logo.png
https://cdn.jsdelivr.net/gh/Corby7/nuvio-assets@main/covers/<name>-cover.webp
```

Note: jsDelivr caches `@main` for up to a week. To bust the cache after
replacing a file, pin a commit hash instead (`@<short-sha>`), or purge via
`https://purge.jsdelivr.net/gh/Corby7/nuvio-assets@main/heroes/<file>`.

## Adding a new ident

```bash
./scripts/make-ident.sh <youtube-url> <name> [start] [duration]
# example:
./scripts/make-ident.sh "https://www.youtube.com/watch?v=XXXX" netflix 0 5
git add heroes stills && git commit -m "add netflix ident" && git push
```

Encoding targets LG webOS hero playback: 1080p max, H.264 high profile,
8-bit yuv420p, no audio, faststart.

> Ident clips are the respective services' brand assets — personal use only.
