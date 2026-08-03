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
