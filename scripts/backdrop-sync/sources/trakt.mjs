// Ported from folderDetailScreen.js's fetchTraktSourceItems. Trakt's list
// API doesn't reliably return usable images (the `images` field needs VIP +
// extended=images and is often empty), so this only extracts each entry's
// ids.tmdb — the caller resolves the actual backdrop via TMDB
// (resolveBackdropsByTmdbId in ../sources/tmdb.mjs).
const TRAKT_API_URL = "https://api.trakt.tv";
const TRAKT_PAGE_SIZE = 50;

function buildHeaders(clientId) {
  if (!clientId) throw new Error("Trakt is not configured");
  return {
    "Content-Type": "application/json",
    "trakt-api-version": "2",
    "trakt-api-key": clientId,
    // Cloudflare's bot protection in front of trakt.tv blocks Node's default
    // fetch User-Agent outright (verified: curl and a browser UA both pass,
    // plain node-fetch gets a 403 challenge page) — this isn't optional.
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
  };
}

// Collections can reference Trakt catalogs through an addon source, as
// {provider: "addon", catalogId: "trakt.list.2143363"} — AIOMetadata used to
// serve those. When the addon stops declaring them (config changed, Trakt
// disconnected) the catalog request just returns an empty list, but the
// underlying data is public: these endpoints need only the app's client id, no
// OAuth. So resolve trakt.* catalog ids against Trakt directly instead.
export function isTraktCatalogId(catalogId) {
  return /^trakt\./i.test(String(catalogId || ""));
}

function traktTypesFor(type) {
  const normalized = String(type || "").toLowerCase();
  if (normalized === "series" || normalized === "tv" || normalized === "show") return ["show"];
  if (normalized === "movie") return ["movie"];
  return ["movie", "show"];
}

function refsFromEntries(entries, forcedKind = null) {
  return (Array.isArray(entries) ? entries : [])
    .map((entry) => {
      const kind = forcedKind || (entry?.show ? "show" : entry?.movie ? "movie" : null);
      const entity = kind === "show" ? entry?.show : entry?.movie;
      if (!entity?.ids?.tmdb) return null;
      return { tmdbId: entity.ids.tmdb, tmdbType: kind === "show" ? "tv" : "movie" };
    })
    .filter(Boolean);
}

async function traktGet(path, clientId) {
  const res = await fetch(`${TRAKT_API_URL}${path}`, { headers: buildHeaders(clientId) });
  const payload = await res.json().catch(() => []);
  if (!res.ok) {
    throw new Error(String(payload?.message || payload?.error || res.statusText || "Trakt request failed"));
  }
  return payload;
}

// Handles the catalog id forms the app stores: trakt.list.<id> and
// trakt.<feed>.<movies|shows> (anticipated, trending, popular, ...).
export async function fetchTraktCatalogRefs(source = {}, clientId, { limit = 60 } = {}) {
  const catalogId = String(source.catalogId || "");
  const listMatch = catalogId.match(/^trakt\.list\.(\d+)$/i);
  if (listMatch) {
    const types = traktTypesFor(source.type).join(",");
    const payload = await traktGet(
      `/lists/${listMatch[1]}/items/${types}?page=1&limit=${limit}&sort_by=rank&sort_how=asc`,
      clientId
    );
    return refsFromEntries(payload);
  }

  const feedMatch = catalogId.match(/^trakt\.([a-z_]+)\.(movies|shows)$/i);
  if (feedMatch) {
    const [, feed, plural] = feedMatch;
    const kind = plural.toLowerCase() === "shows" ? "shows" : "movies";
    const payload = await traktGet(`/${kind}/${feed.toLowerCase()}?page=1&limit=${limit}`, clientId);
    return refsFromEntries(payload, kind === "shows" ? "show" : "movie");
  }

  throw new Error(`unsupported Trakt catalog id "${catalogId}"`);
}

// source shape: { traktListId, mediaType, sortBy, sortHow } (see
// collectionsStore.js normalizeCollectionSource's "trakt" branch)
export async function fetchTraktTmdbRefs(source = {}, clientId) {
  const mediaType = String(source.mediaType || "MOVIE").toUpperCase() === "TV" ? "show" : "movie";
  const url = new URL(`${TRAKT_API_URL}/lists/${encodeURIComponent(String(source.traktListId || ""))}/items/${mediaType}`);
  url.searchParams.set("page", "1");
  url.searchParams.set("limit", String(TRAKT_PAGE_SIZE));
  url.searchParams.set("sort_by", String(source.sortBy || "rank"));
  url.searchParams.set("sort_how", String(source.sortHow || "asc"));

  const res = await fetch(url.toString(), { headers: buildHeaders(clientId) });
  const payload = await res.json().catch(() => []);
  if (!res.ok) {
    throw new Error(String(payload?.message || payload?.error || res.statusText || "Trakt request failed"));
  }

  return (Array.isArray(payload) ? payload : [])
    .map((entry) => (mediaType === "show" ? entry?.show : entry?.movie))
    .map((entity) =>
      entity?.ids?.tmdb ? { tmdbId: entity.ids.tmdb, tmdbType: mediaType === "show" ? "tv" : "movie" } : null
    )
    .filter(Boolean);
}
