const CINEMETA_CATALOGS = "https://cinemeta-catalogs.strem.io";
const CINEMETA = "https://v3-cinemeta.strem.io";
const KITSU = "https://anime-kitsu.strem.fun";
const IMAGE_PROXY = "https://wsrv.nl/?url=";
const CATALOG_PAGE_SIZE = 49;
const ROW_LIMIT = 24;

function getPosterUrl(url) {
  if (!url) return null;
  if (url.includes("kitsu.")) return IMAGE_PROXY + url;
  return url;
}

function parseYear(raw, releaseInfo) {
  const source = raw ?? releaseInfo ?? "";
  const match = String(source).match(/(\d{4})/);
  if (!match) return null;
  return Number(match[1]);
}

function toType(type) {
  return type === "movie" ? "movie" : "series";
}

export function normalizeMeta(meta) {
  const type = toType(meta.type);
  return {
    id: meta.id ?? null,
    title: meta.aliases?.find(Boolean) ?? meta.name ?? "",
    type,
    poster: getPosterUrl(meta.poster),
    backdrop: getPosterUrl(meta.background),
    overview: meta.description ?? null,
    year: parseYear(meta.year, meta.releaseInfo),
    releaseInfo: meta.releaseInfo ?? null,
    genres: meta.genre ?? meta.genres ?? null,
    rating: Number.parseFloat(meta.imdbRating) || null,
    popularity: typeof meta.popularity === "number" ? meta.popularity : null,
    source: "CineStream",
    provider: "CineStream",
    sourceUrl: `${CINEMETA}/meta/${type}/${meta.id}.json`
  };
}

export function normalizeDetail(meta) {
  const base = normalizeMeta(meta);
  const shared = {
    runtime: meta.runtime ?? null,
    cast: Array.isArray(meta.cast) ? meta.cast.slice(0, 12) : null,
    director: Array.isArray(meta.director) ? meta.director.slice(0, 4) : null,
    writer: Array.isArray(meta.writer) ? meta.writer.slice(0, 4) : null,
    country: meta.country ?? null,
    language: meta.language ?? null,
    awards: meta.awards ?? null,
    released: meta.released ?? null,
    status: meta.status ?? null
  };
  if (base.type === "movie") {
    return { ...base, ...shared, episodes: null };
  }
  const episodes = (meta.videos ?? [])
    .filter((ep) => ep.season != null && ep.season !== 0)
    .map((ep) => ({
      id: ep.id ?? null,
      season: ep.season ?? null,
      episode: ep.episode ?? ep.number ?? null,
      name: ep.name ?? ep.title ?? null,
      overview: ep.overview ?? ep.description ?? null,
      thumbnail: getPosterUrl(ep.thumbnail),
      firstAired: ep.firstAired ?? ep.released ?? null,
      rating: Number.parseFloat(ep.rating) || null,
      runtime: ep.runtime ?? null
    }))
    .sort((a, b) => a.season - b.season || a.episode - b.episode);
  return { ...base, ...shared, episodes };
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url} (status ${res.status})`);
  }
  return res.json();
}

function dedupe(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    if (!item.id || seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

export async function fetchCatalog(type, skip, { genre, signal } = {}) {
  let url = `${CINEMETA_CATALOGS}/top/catalog/${type}/top/skip=${skip}`;
  if (genre) url += `&genre=${encodeURIComponent(genre)}`;
  url += ".json";
  const data = await fetchJson(url, { signal });
  return (data.metas ?? []).map(normalizeMeta);
}

export async function getTopMovies(pages = 3, startSkip = 0, signal) {
  const batches = await Promise.all(
    Array.from({ length: pages }, (_, i) =>
      fetchCatalog("movie", startSkip + i * CATALOG_PAGE_SIZE, { signal })
    )
  );
  return dedupe(batches.flat());
}

export async function getTopSeries(pages = 3, startSkip = 0, signal) {
  const batches = await Promise.all(
    Array.from({ length: pages }, (_, i) =>
      fetchCatalog("series", startSkip + i * CATALOG_PAGE_SIZE, { signal })
    )
  );
  return dedupe(batches.flat());
}

export async function getCatalogByGenre(type, genre, pages = 2, startSkip = 0, signal) {
  const batches = await Promise.all(
    Array.from({ length: pages }, (_, i) =>
      fetchCatalog(type, startSkip + i * CATALOG_PAGE_SIZE, { genre, signal })
    )
  );
  return dedupe(batches.flat());
}

export async function fetchKitsuCatalogPage(catalogId, skip, signal) {
  const url = `${KITSU}/catalog/anime/${catalogId}/skip=${skip}.json`;
  const data = await fetchJson(url, { signal });
  return (data.metas ?? []).map(normalizeMeta);
}

export async function getKitsuCatalog(catalogId, pages = 2, signal) {
  const batches = await Promise.all(
    Array.from({ length: pages }, (_, i) => fetchKitsuCatalogPage(catalogId, i * CATALOG_PAGE_SIZE, signal))
  );
  return dedupe(batches.flat());
}

export async function searchCinemeta(query, signal) {
  const endpoints = [
    `${CINEMETA}/catalog/movie/top/search=${encodeURIComponent(query)}.json`,
    `${CINEMETA}/catalog/series/top/search=${encodeURIComponent(query)}.json`,
    `${KITSU}/catalog/anime/kitsu-anime-airing/search=${encodeURIComponent(query)}.json`
  ];
  const results = await Promise.allSettled(endpoints.map((url) => fetchJson(url, { signal })));
  const items = results
    .filter((r) => r.status === "fulfilled")
    .flatMap((r) => (r.value.metas ?? []).map(normalizeMeta));
  return dedupe(items);
}

export async function getCinemetaDetails(type, id, signal) {
  const isKitsu = id.includes("kitsu") || id.includes("mal");
  const base = isKitsu ? KITSU : CINEMETA;
  const rawId = isKitsu ? id.replace(":", "%3A") : id;
  const data = await fetchJson(`${base}/meta/${toType(type)}/${rawId}.json`, { signal });
  const meta = data?.meta;
  if (!meta) throw new Error(`No metadata found for ${type}/${id}`);
  return normalizeDetail(meta);
}

function sortByRating(items) {
  return [...items].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
}

function sortByYear(items) {
  return [...items].filter((item) => item.year != null).sort((a, b) => b.year - a.year);
}

function sortByPopularity(items) {
  return [...items].sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0));
}

export async function buildHomeSections(signal) {
  const definitions = [
    {
      key: "trending",
      title: "Trending Movies",
      fetch: () => getTopMovies(3, 0, signal)
    },
    {
      key: "popular-movies",
      title: "Popular Movies",
      fetch: async () => sortByPopularity(await getTopMovies(4, 147, signal))
    },
    {
      key: "new-releases",
      title: "New Releases",
      fetch: async () => sortByYear(await getTopMovies(4, 343, signal))
    },
    {
      key: "top-rated",
      title: "Top Rated Movies",
      fetch: async () => sortByRating(await getTopMovies(4, 539, signal))
    },
    {
      key: "action",
      title: "Action Movies",
      fetch: () => getCatalogByGenre("movie", "Action", 2, 0, signal)
    },
    {
      key: "comedy",
      title: "Comedy Movies",
      fetch: () => getCatalogByGenre("movie", "Comedy", 2, 0, signal)
    },
    {
      key: "horror",
      title: "Horror Movies",
      fetch: () => getCatalogByGenre("movie", "Horror", 2, 0, signal)
    },
    {
      key: "popular-series",
      title: "Popular Series",
      fetch: () => getTopSeries(3, 0, signal)
    },
    {
      key: "action-series",
      title: "Action Series",
      fetch: () => getCatalogByGenre("series", "Action", 2, 0, signal)
    },
    {
      key: "anime-airing",
      title: "Airing Anime",
      fetch: () => getKitsuCatalog("kitsu-anime-airing", 2, signal)
    },
    {
      key: "anime-trending",
      title: "Trending Anime",
      fetch: () => getKitsuCatalog("kitsu-anime-trending", 2, signal)
    }
  ];

  const seen = new Set();
  const results = await Promise.allSettled(
    definitions.map(async (def) => {
      const raw = await def.fetch();
      const unique = [];
      for (const item of raw) {
        const dedupeKey = `${item.type}:${String(item.title ?? "").toLowerCase()}:${item.year ?? ""}`;
        if (!item.id || seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        unique.push(item);
        if (unique.length >= ROW_LIMIT) break;
      }
      return {
        key: def.key,
        data: {
          key: def.key,
          title: def.title,
          provider: "CineStream",
          count: unique.length,
          items: unique
        }
      };
    })
  );

  return results
    .filter((r) => r.status === "fulfilled")
    .map((r) => r.value);
}
