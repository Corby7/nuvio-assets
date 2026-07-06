# nuvio-assets

Static media assets for my personal NuvioTV setup, served via jsDelivr.

## Layout

- `heroes/` — short looping H.264 MP4 idents used as collection hero videos (`heroVideoUrl`)
- `stills/` — matching still frames shown while the video loads (`heroBackdropUrl`)
- `scripts/make-ident.sh` — download → trim → encode → still-frame pipeline

## URL pattern

```
https://cdn.jsdelivr.net/gh/Corby7/nuvio-assets@main/heroes/<name>-ident.mp4
https://cdn.jsdelivr.net/gh/Corby7/nuvio-assets@main/stills/<name>-ident.jpg
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
