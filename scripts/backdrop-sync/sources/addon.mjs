// Direct Stremio addon catalog protocol fetch, matching the URL-building
// rules in js/data/repository/catalogRepository.js (buildCatalogUrl/encodeArg)
// and addonRepository.js (canonicalizeUrl) — no addon manifest resolution
// needed since folder.sources already embeds addonBaseUrl.
function canonicalizeAddonBaseUrl(url = "") {
  return String(url || "")
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/manifest\.json$/i, "");
}

function encodeArg(value) {
  return encodeURIComponent(value).replace(/\+/g, "%20");
}

function buildCatalogUrl(source = {}, skip = 0) {
  const basePath = canonicalizeAddonBaseUrl(source.addonBaseUrl);
  if (!basePath) throw new Error("Addon source has no addonBaseUrl");
  const args = {};
  if (source.genre) args.genre = source.genre;
  if (skip > 0) args.skip = String(skip);
  const argKeys = Object.keys(args);
  const segment = argKeys.length
    ? `/${argKeys.map((key) => `${encodeArg(key)}=${encodeArg(String(args[key]))}`).join("&")}.json`
    : ".json";
  return `${basePath}/catalog/${encodeURIComponent(source.type)}/${encodeURIComponent(source.catalogId)}${segment}`;
}

// source shape: { addonBaseUrl, catalogId, type, genre } (see
// collectionsStore.js normalizeCollectionSource's "addon" branch, the
// default provider — this is also how MDBList-backed catalogs are consumed,
// via whatever Stremio addon wraps them)
export async function fetchAddonBackdrops(source = {}, { limit = 60 } = {}) {
  // Stremio catalogs page 20 at a time; without this a folder's grid only ever
  // sees the first page of each list.
  const metas = [];
  let skip = 0;
  while (metas.length < limit) {
    const url = buildCatalogUrl(source, skip);
    const res = await fetch(url);
    if (!res.ok) {
      if (skip === 0) throw new Error(`Addon catalog request failed (${res.status}) for ${url}`);
      break;
    }
    const payload = await res.json().catch(() => null);
    const page = Array.isArray(payload?.metas) ? payload.metas : [];
    if (!page.length) break;
    metas.push(...page);
    skip += page.length;
  }
  // Items, not bare URLs: the TMDB id lets the Fanart pass upgrade a plain
  // backdrop to title-logo art. AIOMetadata exposes it as `_tmdbId`.
  return metas
    .map((meta) => ({
      url: downscaleTmdb(meta?.background),
      tmdbId: meta?.moviedb_id || meta?._tmdbId || null,
      kind: meta?.type === "series" || meta?.type === "tv" ? "tv" : "movie",
      originalLanguage: null
    }))
    .filter((item) => item.url);
}

// AIOMetadata hands back /t/p/original art; a grid card never needs > w1280.
function downscaleTmdb(url) {
  return url ? String(url).replace("/t/p/original/", "/t/p/w1280/") : url;
}
