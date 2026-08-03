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

## Collection backdrop sync (`scripts/backdrop-sync/`)

A scheduled GitHub Action (`.github/workflows/backdrop-sync.yml`, daily at
04:00 UTC + manual dispatch) that regenerates the `heroBackdropUrl` for every
folder in the target collection(s) from their *actual current sources*,
instead of a static image. It signs in to Nuvio, pulls each folder's real
`sources` array (whatever mix of TMDB discover/list/collection/person, Trakt
lists, or Stremio addon catalogs — including MDBList, which this app consumes
as an addon catalog — is configured in the app), fetches artwork from each via
`sources/tmdb.mjs` / `sources/trakt.mjs` / `sources/addon.mjs` (ported from
`folderDetailScreen.js`'s own per-provider dispatch), optionally upgrades each
tile to Fanart.tv thumb art via `sources/fanart.mjs` (the art with title logos
baked in), composites them into a rotated masonry collage (ported from
[paytonjewell/Nuvio-Backdrop-Generator](https://github.com/paytonjewell/Nuvio-Backdrop-Generator)'s
canvas renderer, run headlessly via `@napi-rs/canvas`), writes
`backdrops/<folder-slug>.webp` into this repo, and points the folder's
`heroBackdropUrl` at the jsDelivr copy via
`sync_pull_collections`/`sync_push_collections`.

Because it reads each folder's sources live on every run, there's no separate
list of catalogs to keep in sync — edit the sources in the app and the next
run picks it up automatically.

### Why it is cheap to run daily

* Each folder's resolved image-URL list is hashed into `backdrops/manifest.json`.
  An unchanged folder is skipped before any downloading, rendering, committing
  or pushing — a quiet day costs one catalog request per source.
* Output is WebP (~250 KB at 1920x1080), not PNG (megabytes).
* `@napi-rs/canvas` ships prebuilt binaries, so CI needs no cairo/pango/librsvg
  apt packages and no native build step.
* One sign-in, one collections pull and at most one push per run, covering
  every folder.

### Caching

`heroBackdropUrl` is a stable jsDelivr path plus `?v=<content hash>`. jsDelivr
serves `max-age=604800`, so a bare path would keep showing a stale image for up
to a week; the hash changes only when the image actually changes, which makes
updates immediate without refetching on days nothing moved.

### Repo configuration

Secrets (Settings → Secrets and variables → Actions → **Secrets**):

| Secret | Purpose |
| --- | --- |
| `NUVIO_EMAIL` / `NUVIO_PASSWORD` | Nuvio account login (same Supabase password-grant auth the app itself uses) — needed to read each folder's live sources and to write back the new `heroBackdropUrl` |
| `ADDON_BASE_URLS` | required if any folder has addon sources. Collections store the addon by id with `addonBaseUrl: null`, and the real URL lives in the app's local `installedAddonUrls` store, which has no pull RPC. Format: `aio-metadata=https://host/stremio/<config>` (comma or newline separated), or a single bare URL used for every addon source. Keep it a secret — these URLs often embed a config id |
| `FANART_API_KEY` | optional — without it tiles fall back to plain TMDB backdrops and lose the title logos |
| `TMDB_API_KEY` | optional — falls back to the public key already shipped in the Nuvio web client bundle |
| `TRAKT_CLIENT_ID` | optional — falls back to the public client ID already shipped in the Nuvio web client bundle; only used if a folder has a Trakt-sourced list |

Variables (same page → **Variables**):

| Variable | Purpose | Default |
| --- | --- | --- |
| `TARGET_COLLECTION_TITLES` | comma-separated collections to process | `Streaming Services` |
| `TARGET_FOLDER_TITLES` | optional comma-separated filter within those collections | all folders |
| `NUVIO_PROFILE_ID` | local profile index (matches `ProfileManager`) | `1` |
| `ASSETS_BASE_URL` | base URL the generated files are served from | jsDelivr `@main/backdrops` |
| `IMAGE_POOL_SIZE` | max images pulled across all of a folder's sources | `60` |
| `WEBP_QUALITY` | encoder quality | `82` |
| `ACCENT_OPACITY` | strength of the brand-coloured top-right glow | `0.46` |
| `ACCENT_REACH` | how far across the frame the glow falls off | `0.72` |
| `ACCENT_OVERRIDES` | `slug=#rrggbb` pairs. All nine streaming services default to hues recovered from the reference backdrops; cover-sampling is only used for folders without an entry | — |

The workflow needs `permissions: contents: write` to commit the regenerated
files back, which is already set in the workflow file.

### Run locally

```bash
cd scripts/backdrop-sync
npm install
NUVIO_EMAIL=... NUVIO_PASSWORD=... FANART_API_KEY=... npm start
```

`FORCE_REGENERATE=true` bypasses the unchanged-hash check.
