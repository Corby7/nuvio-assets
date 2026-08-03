// Ported from js/ui/screens/collection/folderDetailScreen.js's fetchTmdbSourceItems
// (fetchTmdbSourceItems, applyTmdbDiscoverFilters, mapTmdbListItem) in NuvioWeb —
// same dispatch over tmdbSourceType, but returns plain backdrop URLs since that's
// all a collage composite needs.
const TMDB_API_URL = "https://api.themoviedb.org/3";
const TMDB_IMAGE_BASE_URL_BACKDROP = "https://image.tmdb.org/t/p/w1280";

function toBackdropUrl(path) {
  if (!path) return null;
  return /^https?:\/\//i.test(String(path)) ? String(path) : `${TMDB_IMAGE_BASE_URL_BACKDROP}${path}`;
}

function setParam(params, key, value) {
  if (value == null || value === "") return;
  params.set(key, String(value));
}

function applyDiscoverFilters(params, filters = {}, mediaType = "movie") {
  const isTv = mediaType === "tv";
  setParam(params, "with_genres", filters.withGenres);
  setParam(params, isTv ? "first_air_date.gte" : "primary_release_date.gte", filters.releaseDateGte);
  setParam(params, isTv ? "first_air_date.lte" : "primary_release_date.lte", filters.releaseDateLte);
  setParam(params, "vote_average.gte", filters.voteAverageGte);
  setParam(params, "vote_average.lte", filters.voteAverageLte);
  setParam(params, "vote_count.gte", filters.voteCountGte);
  setParam(params, "with_original_language", filters.withOriginalLanguage);
  setParam(params, "with_origin_country", filters.withOriginCountry);
  setParam(params, "with_keywords", filters.withKeywords);
  setParam(params, "with_companies", filters.withCompanies);
  if (isTv) setParam(params, "with_networks", filters.withNetworks);
  if (Number.isFinite(Number(filters.year)) && Number(filters.year) > 0) {
    params.set(isTv ? "first_air_date_year" : "year", String(Math.trunc(Number(filters.year))));
  }
  if (filters.withWatchProviders) {
    setParam(params, "watch_region", filters.watchRegion || "US");
    setParam(params, "with_watch_providers", filters.withWatchProviders);
    params.set("with_watch_monetization_types", "flatrate|free|ads|rent|buy");
  }
}

async function fetchJson(url) {
  const res = await fetch(url);
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(String(payload?.status_message || res.statusText || "TMDB request failed"));
  }
  return payload;
}

// source shape: { tmdbSourceType, tmdbId, mediaType, sortBy, filters } (see
// collectionsStore.js normalizeCollectionSource's "tmdb" branch)
export async function fetchTmdbBackdrops(source = {}, apiKey, language = "en-US") {
  if (!apiKey) throw new Error("TMDB is not configured");
  const type = String(source.tmdbSourceType || "").toUpperCase();
  const mediaType = type === "NETWORK" || String(source.mediaType || "MOVIE").toUpperCase() === "TV" ? "tv" : "movie";

  if (type === "COLLECTION") {
    const payload = await fetchJson(
      `${TMDB_API_URL}/collection/${encodeURIComponent(String(source.tmdbId))}?api_key=${encodeURIComponent(apiKey)}&language=${encodeURIComponent(language)}`
    );
    return (payload?.parts || []).map((part) => toBackdropUrl(part.backdrop_path)).filter(Boolean);
  }
  if (type === "LIST") {
    const payload = await fetchJson(
      `${TMDB_API_URL}/list/${encodeURIComponent(String(source.tmdbId))}?api_key=${encodeURIComponent(apiKey)}&language=${encodeURIComponent(language)}`
    );
    return (payload?.items || []).map((item) => toBackdropUrl(item.backdrop_path)).filter(Boolean);
  }
  if (type === "PERSON" || type === "DIRECTOR") {
    const payload = await fetchJson(
      `${TMDB_API_URL}/person/${encodeURIComponent(String(source.tmdbId))}/combined_credits?api_key=${encodeURIComponent(apiKey)}&language=${encodeURIComponent(language)}`
    );
    const entries =
      type === "DIRECTOR"
        ? (payload?.crew || []).filter((entry) => String(entry?.job || "").toLowerCase() === "director")
        : payload?.cast || [];
    return entries.map((entry) => toBackdropUrl(entry.backdrop_path)).filter(Boolean);
  }

  const params = new URLSearchParams({
    api_key: apiKey,
    language,
    sort_by: String(source.sortBy || (mediaType === "tv" ? "first_air_date.desc" : "popularity.desc"))
  });
  const filters = source.filters && typeof source.filters === "object" ? source.filters : {};
  applyDiscoverFilters(params, filters, mediaType);
  if (type === "COMPANY" && source.tmdbId) {
    params.set("with_companies", String(source.tmdbId));
  }
  if (type === "NETWORK" && source.tmdbId) {
    params.set("with_networks", String(source.tmdbId));
    params.set("first_air_date.lte", filters.releaseDateLte || new Date().toISOString().slice(0, 10));
    params.set("with_status", "0|3|4");
  }
  const payload = await fetchJson(`${TMDB_API_URL}/discover/${mediaType}?${params.toString()}`);
  return (payload?.results || [])
    .map((item) => ({
      url: toBackdropUrl(item.backdrop_path),
      tmdbId: item.id || null,
      kind: mediaType,
      originalLanguage: item.original_language || null
    }))
    .filter((item) => item.url);
}

async function mapWithConcurrency(items, limit, fn) {
  const results = [];
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: limit }, worker));
  return results;
}

// For sources whose items don't carry a usable image of their own (Trakt) —
// resolves {tmdbId, tmdbType} refs to a w1280 backdrop URL via TMDB details.
export async function resolveBackdropsByTmdbId(refs, apiKey, { concurrency = 5 } = {}) {
  const resolved = await mapWithConcurrency(refs, concurrency, async (ref) => {
    const res = await fetch(`${TMDB_API_URL}/${ref.tmdbType}/${ref.tmdbId}?api_key=${encodeURIComponent(apiKey)}`);
    if (!res.ok) return null;
    const details = await res.json().catch(() => null);
    const url = toBackdropUrl(details?.backdrop_path);
    if (!url) return null;
    return {
      url,
      tmdbId: ref.tmdbId,
      kind: ref.tmdbType === "tv" ? "tv" : "movie",
      originalLanguage: details?.original_language || null
    };
  });
  return resolved.filter(Boolean);
}
