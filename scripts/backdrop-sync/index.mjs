// Regenerates the hero backdrop for every folder in the target collection(s),
// writes each as WebP into ../../backdrops/, and points heroBackdropUrl at the
// jsDelivr copy.
//
// Efficiency notes, since this runs unattended every day:
//   * one sign-in + one collections pull + at most one push per run
//   * each folder's resolved image-URL list is hashed and compared against
//     backdrops/manifest.json — unchanged folders are skipped entirely, so a
//     quiet day does no downloading, no rendering and no commit
//   * the hash doubles as the ?v= cache-buster, so a stable jsDelivr path can
//     still update instantly despite its 7-day browser cache
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { fetchTmdbBackdrops, resolveBackdropsByTmdbId } from "./sources/tmdb.mjs";
import { fetchTraktTmdbRefs, fetchTraktCatalogRefs, isTraktCatalogId } from "./sources/trakt.mjs";
import { fetchAddonBackdrops } from "./sources/addon.mjs";
import { resolveArtUrls } from "./sources/fanart.mjs";
import {
  renderBackdropCollage,
  encodeWebp,
  loadImagesFromUrls,
  accentFromImage,
  parseAccent
} from "./render.mjs";
import { loadImage } from "@napi-rs/canvas";
import { signIn, pullCollections, pushCollections } from "./nuvio.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..");
const OUT_DIR = join(REPO_ROOT, "backdrops");
const MANIFEST_PATH = join(OUT_DIR, "manifest.json");

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var ${name}`);
  return value;
}

// Public keys already shipped in the Nuvio web client bundle
// (https://web.nuvioapp.space/nuvio.env.js) — used as defaults so this
// script doesn't need its own TMDB/Trakt registration, but both are
// overridable via env.
const DEFAULT_TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
const DEFAULT_TRAKT_CLIENT_ID =
  "e04d98107c4066fb86e123e320306dd4fa0309c4ea2f63235f008a48e115944b";

const DEFAULT_ASSETS_BASE_URL =
  "https://cdn.jsdelivr.net/gh/Corby7/nuvio-assets@main/backdrops";

const LAYOUT_SETTINGS = {
  angleDeg: 12,
  gap: 12,
  scale: 1.3,
  radius: 10,
  autoStagger: true,
  stagger: 0,
  bgColor: "#0b0b0f",
  overlayPreset: "reference",
  overlayOpacity: 0.85,
  overlayReach: 0.6,
  imageType: "backdrop",
  imageOpacity: 1,
  width: 1920,
  height: 1080
};

// Covers whose dominant colour is not the brand colour: Hulu's samples blue
// against its green brand, Peacock's samples a desaturated grey.
// Hues recovered from the reference backdrops themselves (sampled at the glow's
// peak in the top-right and un-composited through its 118/255 alpha), then
// normalised to a common brightness. Cover-sampling gets several of these
// wrong — Crunchyroll reads brown rather than orange, Apple TV's near-monochrome
// cover gives no usable hue at all.
const DEFAULT_ACCENT_OVERRIDES = {
  "apple-tv": "#e095cb",
  crunchyroll: "#e0631b",
  "disney-plus": "#15d6e0",
  "hbo-max": "#cc17e0",
  hulu: "#25e084",
  netflix: "#e01727",
  "paramount-plus": "#196ae0",
  peacock: "#e09b4e",
  "prime-video": "#1d77e0"
};

// Keeps generated filenames aligned with the assets already in backdrops/.
const SLUG_OVERRIDES = {
  "amazon prime": "prime-video",
  "apple tv": "apple-tv"
};

function slugify(title) {
  const raw = String(title || "").trim().toLowerCase();
  if (SLUG_OVERRIDES[raw]) return SLUG_OVERRIDES[raw];
  return raw
    .replace(/\+/g, "-plus")
    .replace(/&/g, "-and-")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ADDON_BASE_URLS accepts "addonId=https://..." pairs (comma or newline
// separated), or a single bare URL used for every addon source.
function parseAddonBaseUrls(raw) {
  const text = String(raw || "").trim();
  if (!text) return {};
  if (/^https?:\/\//i.test(text) && !text.includes("=")) return { "*": text };
  const map = {};
  for (const part of text.split(/[\n,]+/)) {
    const entry = part.trim();
    if (!entry) continue;
    const index = entry.indexOf("=");
    if (index <= 0) continue;
    map[entry.slice(0, index).trim()] = entry.slice(index + 1).trim();
  }
  return map;
}

function parseAccentOverrides(raw) {
  const map = { ...DEFAULT_ACCENT_OVERRIDES };
  for (const part of String(raw || "").split(/[\n,]+/)) {
    const entry = part.trim();
    if (!entry) continue;
    const index = entry.indexOf("=");
    if (index <= 0) continue;
    map[entry.slice(0, index).trim().toLowerCase()] = entry.slice(index + 1).trim();
  }
  return map;
}

// Brand tint for a folder: an explicit override wins, otherwise it is sampled
// from the folder's own cover art. Falls back to no glow rather than guessing.
async function resolveAccent(folder, slug, overrides) {
  const override = parseAccent(overrides[slug]);
  if (override) return override;
  const coverUrl = folder.coverImageUrl || folder.coverImage;
  if (!coverUrl) return null;
  try {
    const res = await fetch(coverUrl);
    if (!res.ok) return null;
    return accentFromImage(await loadImage(Buffer.from(await res.arrayBuffer())));
  } catch {
    return null;
  }
}

// Collection/folder titles can carry invisible bidi marks (the Discover
// collection's title starts with U+200E), which would break plain matching.
function normalizeTitle(value) {
  return String(value || "")
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069\u200b]/g, "")
    .trim()
    .toLowerCase();
}

function sourceLabel(source = {}) {
  return `${source.provider || "addon"}:${source.title || source.catalogName || source.catalogId || source.tmdbSourceType || ""}`;
}

async function fetchSourceItems(source, config) {
  const provider = String(source.provider || "addon").toLowerCase();
  if (provider === "tmdb") {
    return fetchTmdbBackdrops(source, config.tmdbApiKey, config.language);
  }
  if (provider === "trakt") {
    const refs = await fetchTraktTmdbRefs(source, config.traktClientId);
    return resolveBackdropsByTmdbId(refs, config.tmdbApiKey);
  }
  // An addon source pointing at a trakt.* catalog goes straight to Trakt: the
  // addon returns an empty list for these once it stops declaring them, and
  // the data behind them is public anyway.
  if (isTraktCatalogId(source.catalogId)) {
    const refs = await fetchTraktCatalogRefs(source, config.traktClientId);
    return resolveBackdropsByTmdbId(refs, config.tmdbApiKey);
  }
  return fetchAddonBackdrops(source, { baseUrlOverrides: config.addonBaseUrls });
}

// Round-robins across sources so no single list dominates the grid, dropping
// duplicates by URL.
function interleave(lists) {
  const seen = new Set();
  const merged = [];
  const maxLen = Math.max(0, ...lists.map((list) => list.length));
  for (let i = 0; i < maxLen; i++) {
    for (const list of lists) {
      const item = list[i];
      if (!item?.url || seen.has(item.url)) continue;
      seen.add(item.url);
      merged.push(item);
    }
  }
  return merged;
}

async function readManifest() {
  try {
    return JSON.parse(await readFile(MANIFEST_PATH, "utf8"));
  } catch {
    return {};
  }
}

function hashUrls(urls) {
  return createHash("sha1").update(urls.join("\n")).digest("hex").slice(0, 8);
}

function targetFolders(collections, collectionTitles, folderTitles) {
  const wantCollection = new Set(collectionTitles.map(normalizeTitle).filter(Boolean));
  const wantFolder = new Set(folderTitles.map(normalizeTitle).filter(Boolean));
  const targets = [];
  for (const collection of collections || []) {
    if (wantCollection.size && !wantCollection.has(normalizeTitle(collection?.title))) {
      continue;
    }
    for (const folder of collection?.folders || []) {
      if (wantFolder.size && !wantFolder.has(normalizeTitle(folder?.title))) {
        continue;
      }
      targets.push({ collection, folder });
    }
  }
  return targets;
}

async function main() {
  const tmdbApiKey = process.env.TMDB_API_KEY || DEFAULT_TMDB_API_KEY;
  const traktClientId = process.env.TRAKT_CLIENT_ID || DEFAULT_TRAKT_CLIENT_ID;
  const fanartKey = process.env.FANART_API_KEY || "";
  const addonBaseUrls = parseAddonBaseUrls(process.env.ADDON_BASE_URLS);
  const accentOverrides = parseAccentOverrides(process.env.ACCENT_OVERRIDES);
  const nuvioEmail = requireEnv("NUVIO_EMAIL");
  const nuvioPassword = requireEnv("NUVIO_PASSWORD");
  const profileId = Number(process.env.NUVIO_PROFILE_ID || "1");
  const assetsBaseUrl = (process.env.ASSETS_BASE_URL || DEFAULT_ASSETS_BASE_URL).replace(/\/+$/, "");
  const poolSize = Number(process.env.IMAGE_POOL_SIZE || "60");
  const quality = Number(process.env.WEBP_QUALITY || "82");
  const accentOpacity = Number(process.env.ACCENT_OPACITY || "0.46");
  const accentReach = Number(process.env.ACCENT_REACH || "0.72");
  const force = process.env.FORCE_REGENERATE === "true";
  const collectionTitles = (process.env.TARGET_COLLECTION_TITLES || "Streaming Services,Discover").split(",");
  // Discover folders ("Trending Shows", "Top Rated", ...) have no brand
  // colour, so they get the dark gradients for text legibility but no tint.
  const accentCollections = new Set(
    (process.env.ACCENT_COLLECTIONS || "Streaming Services").split(",").map(normalizeTitle).filter(Boolean)
  );
  const folderTitles = (process.env.TARGET_FOLDER_TITLES || "").split(",");

  console.log("Signing in to Nuvio...");
  const accessToken = await signIn(nuvioEmail, nuvioPassword);

  console.log(`Pulling collections (profile ${profileId})...`);
  const collections = await pullCollections(accessToken, profileId);
  const targets = targetFolders(collections, collectionTitles, folderTitles);
  if (!targets.length) {
    throw new Error(`No folders matched collection(s) "${collectionTitles.join(", ")}"`);
  }
  console.log(`${targets.length} folder(s) to check\n`);

  await mkdir(OUT_DIR, { recursive: true });
  const manifest = await readManifest();
  let changed = 0;
  let skipped = 0;
  const failures = [];

  for (const { collection, folder } of targets) {
    const label = `${collection.title} > ${folder.title}`;
    const slug = slugify(folder.title);
    try {
      const sources = (Array.isArray(folder.sources) && folder.sources.length
        ? folder.sources
        : folder.catalogSources) || [];
      if (!sources.length) {
        console.log(`- ${label}: no sources configured, skipping`);
        skipped++;
        continue;
      }

      const perSource = await Promise.all(
        sources.map(async (source) => {
          try {
            return await fetchSourceItems(source, { tmdbApiKey, traktClientId, addonBaseUrls, language: "en-US" });
          } catch (error) {
            console.warn(`  ${sourceLabel(source)} failed: ${error.message}`);
            return [];
          }
        })
      );

      const items = interleave(perSource).slice(0, poolSize);
      if (!items.length) {
        throw new Error("no backdrops resolved from any source");
      }

      // Hash before any downloading — an unchanged list costs one catalog
      // request per source and nothing else.
      const wantsAccent = accentCollections.has(normalizeTitle(collection.title));
      const accent = wantsAccent ? await resolveAccent(folder, slug, accentOverrides) : null;
      const fingerprint = hashUrls([
        ...items.map((item) => item.url),
        `accent:${accent ? accent.join(",") : "none"}`
      ]);
      const expectedUrl = `${assetsBaseUrl}/${slug}.webp?v=${fingerprint}`;
      if (!force && manifest[slug]?.hash === fingerprint && folder.heroBackdropUrl === expectedUrl) {
        console.log(`- ${label}: unchanged (${fingerprint}), skipping`);
        skipped++;
        continue;
      }

      const artUrls = fanartKey
        ? await resolveArtUrls(items, { fanartKey, tmdbApiKey, preferredLanguage: "en" })
        : items.map((item) => item.url);

      const images = await loadImagesFromUrls(artUrls);
      if (!images.length) {
        throw new Error("no images could be downloaded/decoded");
      }

      const buffer = await encodeWebp(
        renderBackdropCollage(images, {
          ...LAYOUT_SETTINGS,
          accentColor: accent,
          accentOpacity,
          accentReach
        }),
        quality
      );
      await writeFile(join(OUT_DIR, `${slug}.webp`), buffer);

      folder.heroBackdropUrl = expectedUrl;
      manifest[slug] = {
        hash: fingerprint,
        folder: label,
        images: images.length,
        bytes: buffer.length,
        updatedAt: new Date().toISOString()
      };
      changed++;
      console.log(
        `- ${label}: wrote backdrops/${slug}.webp (${images.length} images, ${Math.round(buffer.length / 1024)} KB, ` +
          `accent=${accent ? `rgb(${accent.join(",")})` : "none"}, v=${fingerprint})`
      );
    } catch (error) {
      failures.push(`${label}: ${error.message}`);
      console.warn(`- ${label}: FAILED — ${error.message}`);
    }
  }

  console.log(`\nchanged=${changed} skipped=${skipped} failed=${failures.length}`);

  if (changed > 0) {
    await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log("Pushing collections...");
    await pushCollections(accessToken, profileId, collections);
  } else {
    console.log("Nothing changed — no collection push, no commit.");
  }

  // Signals the workflow's commit step without it having to re-derive anything.
  if (process.env.GITHUB_OUTPUT) {
    await writeFile(process.env.GITHUB_OUTPUT, `changed=${changed}\n`, { flag: "a" });
  }

  if (failures.length) {
    throw new Error(`${failures.length} folder(s) failed:\n  ${failures.join("\n  ")}`);
  }
}

main().catch((error) => {
  console.error("backdrop-sync failed:", error.message);
  process.exitCode = 1;
});
