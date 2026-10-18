const URLS_JSON = "https://raw.githubusercontent.com/SaurabhKaperwan/Utils/refs/heads/main/urls.json";
const FALLBACK_BASE = "https://vegamovies.gallery";
const HOST_PATTERN = /(nexdrive\.|vcloud\.|hubcloud\.|fastdl\.|filebee\.|vegadrive\.|pixeldrain\.|gofile\.|gdflix\.|hubdrive\.|driveseed\.|driveleech\.|drivebot\.)/i;
const NOISE_LINK_PATTERN = /(xmlrpc\.php|wp-json|wp-content|wp-includes|wp-admin|\/feed\/?|comments\/feed|\/comments\/?|\/tag\/|\/category\/|\/page\/\d|\/author\/|\.(css|js|png|jpe?g|svg|ico|webp|gif)(\?|$)|\/wp-login)/i;
const MEDIA_URL_PATTERN = /https?:\/\/[^\s"'<>\\]+?\.(?:mkv|mp4|m3u8|webm)(?:\?[^\s"'<>\\]*)?/gi;
const DIRECT_HOST_PATTERN = /(r2\.dev\/|cloudflarestorage\.com\/|pixeldrain\.|hubcloud\.|gpdl\d*\.)/i;
const SERIES_HINT = /web-?series|season\s*\d|series/i;
const PLACEHOLDER_PATTERN = /(unpkg\.com|site\.webm|placeholder|sample\.(?:mp4|webm|mkv))/i;

export function isPlaceholderMedia(url) {
  return PLACEHOLDER_PATTERN.test(url);
}

export function candidateRank(url) {
  if (/\.(mkv|mp4)(\?|$)/i.test(url)) return 0;
  if (/\.m3u8(\?|$)/i.test(url)) return 1;
  if (/\.webm(\?|$)/i.test(url)) return 2;
  return 3;
}

export function episodeFromUrl(url) {
  const match = String(url ?? "").match(/s(\d{1,2})[\s._-]*e(\d{1,3})/i);
  if (!match) return null;
  return { season: Number(match[1]), episode: Number(match[2]) };
}

export function pickCandidateForEpisode(candidates, { season = null, episode = null } = {}) {
  if (season == null || episode == null) return { url: candidates[0] ?? null, matched: false, total: candidates.length };
  const withEpisodes = candidates.map((url) => ({ url, ep: episodeFromUrl(url) }));
  const exact = withEpisodes.find((entry) => entry.ep && entry.ep.season === Number(season) && entry.ep.episode === Number(episode));
  if (exact) return { url: exact.url, matched: true, total: candidates.length, episode: exact.ep };
  return { url: null, matched: false, total: candidates.length, available: withEpisodes.filter((e) => e.ep).map((e) => e.ep) };
}

export function hostLinkIndexForEpisode(season, episode) {
  if (season == null || episode == null) return null;
  return Math.max(0, Number(episode) - 1);
}

export function selectMediaCandidates(urls) {
  return Array.from(new Set(urls))
    .filter((url) => !isPlaceholderMedia(url))
    .sort((a, b) => candidateRank(a) - candidateRank(b));
}

export function cleanVegaTitle(raw) {
  if (!raw) return { title: "", year: null };
  let value = String(raw).replace(/^download\s+/i, "").trim();
  const yearMatch = value.match(/\((\d{4})\)/);
  const year = yearMatch ? Number(yearMatch[1]) : null;
  if (yearMatch) {
    value = value.slice(0, yearMatch.index).trim();
  } else {
    value = value.replace(/\b(?:web-?dl|bluray|blu-ray|hdrip|dvdrip|webrip|dual audio|hindi|english|org|x264|x265|hevc|10bit|480p|720p|1080p|2160p|4k|esubs?|subtitles?)\b.*/i, "").trim();
  }
  value = value.replace(/[\[{].*$/s, "").replace(/[\s|,-]+$/, "").trim();
  return { title: value || String(raw).trim(), year };
}

export function decodeDoubleAtob(value) {
  try {
    const once = atob(value);
    return atob(once);
  } catch {
    return null;
  }
}

export function extractDoubleAtobValue(html) {
  const match = html.match(/atob\s*\(\s*atob\s*\(\s*['"]([^'"]+)['"]\s*\)\s*\)/i);
  return match ? decodeDoubleAtob(match[1]) : null;
}

export function extractHostLinks(html) {
  const links = new Set();
  for (const match of html.matchAll(/href="([^"]+)"/gi)) {
    const href = match[1];
    if (!HOST_PATTERN.test(href)) continue;
    if (NOISE_LINK_PATTERN.test(href)) continue;
    links.add(href);
  }
  return Array.from(links);
}

export function extractLinkPages(html, baseUrl) {
  const ordered = new Map();
  let heading = null;
  const combined = /(<h[3-5][^>]*>[\s\S]*?<\/h[3-5]>)|(<a\s+([^>]*)>([\s\S]*?)<\/a>)/gi;
  for (const match of html.matchAll(combined)) {
    if (match[1]) {
      heading = match[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 90);
      continue;
    }
    const attrs = match[3] ?? "";
    const inner = match[4] ?? "";
    const href = (attrs.match(/href="([^"]+)"/i) || [])[1];
    if (!href) continue;
    const label = inner.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const absolute = href.startsWith("http") ? href : new URL(href, baseUrl).href;
    if (NOISE_LINK_PATTERN.test(absolute)) continue;
    const isDownloadButton = /dwd-button/i.test(inner);
    const isHostLink = HOST_PATTERN.test(absolute);
    if (!isDownloadButton && !isHostLink) continue;
    if (!ordered.has(absolute)) {
      ordered.set(absolute, {
        url: absolute,
        label: label.slice(0, 60),
        kind: isDownloadButton ? "download" : "host",
        heading
      });
    }
  }
  return Array.from(ordered.values());
}

export function extractDirectMediaUrls(html) {
  const urls = new Set();
  for (const match of html.matchAll(MEDIA_URL_PATTERN)) {
    urls.add(match[0]);
  }
  return Array.from(urls);
}

export function pixelDrainApiUrl(url) {
  const match = String(url ?? "").match(/pixeldrain\.(?:dev|com)\/(?:u|file|api\/file)\/([\w-]+)/i);
  if (!match) return null;
  return `https://pixeldrain.com/api/file/${match[1]}?download`;
}

export function mediaCandidatesFromHtml(html) {
  const out = new Set();
  for (const url of extractDirectMediaUrls(html)) out.add(url);

  for (const match of html.matchAll(/href="([^"]+)"/gi)) {
    const href = match[1].replace(/&amp;/g, "&");
    if (NOISE_LINK_PATTERN.test(href)) continue;
    const pixeldrain = pixelDrainApiUrl(href);
    if (pixeldrain) {
      out.add(pixeldrain);
      continue;
    }
    if (DIRECT_HOST_PATTERN.test(href) && !/\.(css|js|png|jpe?g|svg|ico|woff2?)(\?|$)/i.test(href)) {
      out.add(href);
    }
  }

  const pxlMatch = html.match(/var\s+pxl\s*=\s*["']([^"']+)["']/i);
  if (pxlMatch) {
    const pxlApi = pixelDrainApiUrl(pxlMatch[1]);
    if (pxlApi) out.add(pxlApi);
  }

  return Array.from(out);
}

export function parseVegaSearch(json) {
  const hits = json?.hits ?? [];
  return hits
    .map((hit) => {
      const doc = hit?.document ?? {};
      const permalink = doc.permalink ?? null;
      if (!permalink) return null;
      const { title, year } = cleanVegaTitle(doc.post_title);
      const type = SERIES_HINT.test(`${doc.post_title ?? ""} ${permalink}`) ? "series" : "movie";
      return {
        id: permalink,
        title: title || doc.post_title,
        year,
        type,
        poster: doc.post_image ?? null
      };
    })
    .filter(Boolean);
}

export async function getVegaBaseUrl(signal) {
  try {
    const res = await fetch(URLS_JSON, { signal });
    if (res.ok) {
      const data = await res.json();
      if (data && typeof data.vegamovies === "string" && data.vegamovies.startsWith("http")) {
        return data.vegamovies;
      }
    }
  } catch {
    // ignore
  }
  return FALLBACK_BASE;
}

export async function resolveVegaStream({ title, year, type = "movie", season = null, episode = null, signal }) {
  let base;
  try {
    base = await getVegaBaseUrl(signal);
  } catch {
    base = FALLBACK_BASE;
  }

  const searchUrl = `${base}/search.php?q=${encodeURIComponent(title)}&page=1`;
  let searchJson;
  try {
    const res = await fetch(searchUrl, { signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    searchJson = await res.json();
  } catch (err) {
    const isCors = err.name === "TypeError" || /cors|failed to fetch|network/i.test(err.message);
    return {
      status: "cors_blocked",
      error: isCors
        ? `CORS policy restriction: Browser blocked direct fetch to ${base}. VegaMovies endpoints do not permit cross-origin browser access.`
        : `Provider unreachable: ${err.message}`
    };
  }

  const items = parseVegaSearch(searchJson);
  if (items.length === 0) {
    return { status: "not_found", error: `No match found on VegaMovies for "${title}"` };
  }

  const match = items[0];
  try {
    const pageRes = await fetch(match.id, { signal });
    const pageHtml = await pageRes.text();
    const linkPages = extractLinkPages(pageHtml, match.id);
    const mediaCandidates = extractDirectMediaUrls(pageHtml);
    if (mediaCandidates.length > 0) {
      const picked = pickCandidateForEpisode(mediaCandidates, { season, episode });
      if (picked.url) {
        return {
          status: "provider_stream",
          url: picked.url,
          title: match.title,
          year: match.year,
          mediaType: picked.url.includes(".m3u8") ? "hls" : "mkv",
          sourceType: "provider",
          note: `Resolved via VegaMovies: "${match.title}"`
        };
      }
    }
    return {
      status: "unsupported",
      error: `VegaMovies match found but direct media stream extraction required cross-origin host unwrapping.`
    };
  } catch (err) {
    return {
      status: "cors_blocked",
      error: `Browser CORS blocked reading VegaMovies page (${err.message})`
    };
  }
}
