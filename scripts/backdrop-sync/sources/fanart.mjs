// Fanart.tv artwork lookup. Fanart's thumb art usually has the title logo
// baked in, which is what gives the reference backdrops their look.
//
// Priority matches the pipeline this was modelled on: art in the preferred or
// the title's original language beats the plain TMDB backdrop; textless and
// other-language art rank below it. Thumbs outrank backgrounds, and within a
// bucket the most-liked entry wins.
const FANART_BASE = "https://webservice.fanart.tv/v3";
const TMDB_API_URL = "https://api.themoviedb.org/3";

async function getJson(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function normalizeLang(value) {
  const text = String(value || "").trim().toLowerCase();
  return text === "" || text === "00" || text === "none" || text === "null" ? null : text;
}

function pickBest(entries) {
  if (!entries.length) return null;
  entries.sort((a, b) => a.rank - b.rank || b.likes - a.likes);
  return entries[0].url;
}

async function fanartGroupsFor(item, fanartKey, tmdbApiKey) {
  if (!item.tmdbId) return null;
  if (item.kind === "tv") {
    // Fanart keys TV by TVDB id, so it needs one hop through TMDB.
    const external = await getJson(
      `${TMDB_API_URL}/tv/${item.tmdbId}/external_ids?api_key=${encodeURIComponent(tmdbApiKey)}`
    );
    const tvdbId = external?.tvdb_id;
    if (!tvdbId) return null;
    const data = await getJson(`${FANART_BASE}/tv/${tvdbId}?api_key=${encodeURIComponent(fanartKey)}`);
    if (!data) return null;
    return [data.tvthumb || [], data.showbackground || []];
  }
  const data = await getJson(`${FANART_BASE}/movies/${item.tmdbId}?api_key=${encodeURIComponent(fanartKey)}`);
  if (!data) return null;
  return [data.moviethumb || [], data.moviebackground || []];
}

// Returns the URL this item should render with: Fanart art when it is in a
// language we want, otherwise the item's existing (TMDB) URL.
export async function resolveArtUrl(item, { fanartKey, tmdbApiKey, preferredLanguage = "en" }) {
  if (!fanartKey || !tmdbApiKey) return item.url;

  const groups = await fanartGroupsFor(item, fanartKey, tmdbApiKey);
  if (!groups) return item.url;

  const preferred = normalizeLang(preferredLanguage);
  const original = normalizeLang(item.originalLanguage);
  const wanted = [];
  const textless = [];

  groups.forEach((candidates, rank) => {
    for (const candidate of candidates) {
      if (!candidate?.url) continue;
      const lang = normalizeLang(candidate.lang);
      const entry = { rank, likes: Number(candidate.likes) || 0, url: candidate.url };
      if ((preferred && lang === preferred) || (original && lang === original)) {
        wanted.push(entry);
      } else if (lang === null) {
        textless.push(entry);
      }
    }
  });

  // Language-matched art wins outright; textless only fills in when the item
  // has no TMDB backdrop at all.
  return pickBest(wanted) || item.url || pickBest(textless);
}

export async function resolveArtUrls(items, options, { concurrency = 8 } = {}) {
  const out = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      out[index] = await resolveArtUrl(items[index], options);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return out.filter(Boolean);
}
