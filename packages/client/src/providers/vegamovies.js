import { toProxiedUrl } from "../lib/proxy.js";

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

export function normalizeForMatch(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function scoreTitleMatch(query, candidateTitle, candidateYear, wantedYear) {
  const q = normalizeForMatch(query);
  const t = normalizeForMatch(candidateTitle);
  if (!q || !t) return 0;

  let score;
  if (t === q) score = 1000;
  else if (t.startsWith(`${q} `)) score = 700 - Math.min(100, t.length - q.length);
  else if (t.startsWith(q)) score = 650;
  else if (new RegExp(`(?:^| )${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?: |$)`).test(t)) score = 500;
  else if (q.split(" ").every((token) => t.split(" ").includes(token))) score = 400;
  else if (t.includes(q)) score = 300;
  else {
    const qTokens = q.split(" ").filter(Boolean);
    const tTokens = new Set(t.split(" ").filter(Boolean));
    const overlap = qTokens.filter((token) => tTokens.has(token)).length;
    score = qTokens.length > 0 ? Math.round((overlap / qTokens.length) * 200) : 0;
  }

  if (score > 0 && wantedYear && candidateYear) {
    const diff = Math.abs(Number(candidateYear) - Number(wantedYear));
    if (diff === 0) score += 120;
    else if (diff === 1) score += 60;
    else if (diff > 3) score -= 80;
  }
  return Math.max(0, score);
}

export function pickBestMatch(items, { title, year, minScore = 400 } = {}) {
  let best = null;
  let bestScore = 0;
  for (const item of items) {
    const score = scoreTitleMatch(title, item.title, item.year, year);
    if (score > bestScore) {
      bestScore = score;
      best = item;
    }
  }
  return bestScore >= minScore ? { item: best, score: bestScore } : null;
}

export function rankTitleCandidates(items, { title, year = null, type = null, minScore = 400, limit = 5 } = {}) {
  const scored = [];
  for (const item of items) {
    let score = scoreTitleMatch(title, item.title, item.year, year);
    if (score <= 0) continue;
    if (type && item.type) {
      score += item.type === type ? 90 : -120;
    }
    if (score >= minScore) scored.push({ item, score });
  }
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return (Number(b.item.year) || 0) - (Number(a.item.year) || 0);
  });

  const seen = new Set();
  const unique = [];
  for (const entry of scored) {
    const key = entry.item.id ?? `${entry.item.title}:${entry.item.year}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(entry);
    if (unique.length >= limit) break;
  }
  return unique;
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
    const res = await fetch(toProxiedUrl(URLS_JSON), { signal });
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
  if (signal?.aborted) {
    const err = new Error("Aborted");
    err.name = "AbortError";
    throw err;
  }

  let base;
  try {
    base = await getVegaBaseUrl(signal);
  } catch {
    base = FALLBACK_BASE;
  }

  if (signal?.aborted) {
    const err = new Error("Aborted");
    err.name = "AbortError";
    throw err;
  }

  const rawSearchUrl = `${base}/search.php?q=${encodeURIComponent(title)}&page=1`;
  const proxiedSearchUrl = toProxiedUrl(rawSearchUrl);
  let searchJson;
  try {
    const res = await fetch(proxiedSearchUrl, { signal });
    if (!res.ok) {
      return {
        status: "http_error",
        httpStatus: res.status,
        error: `VegaMovies resolution failed: "${rawSearchUrl}" returned HTTP ${res.status} (${res.statusText || "Error"}). The active VegaMovies endpoint does not host a working search index.`
      };
    }
    const contentType = res.headers.get("content-type") || "";
    const rawText = await res.text();
    try {
      searchJson = JSON.parse(rawText);
    } catch {
      return {
        status: "invalid_response",
        error: `VegaMovies resolution failed: "${rawSearchUrl}" returned non-JSON content (Content-Type: "${contentType}"). The provider returned a landing page or challenge instead of search index data.`
      };
    }
  } catch (err) {
    if (signal?.aborted || err.name === "AbortError") {
      const abortErr = new Error("Aborted");
      abortErr.name = "AbortError";
      throw abortErr;
    }
    return {
      status: "cors_blocked",
      error: `VegaMovies resolution unavailable: Direct browser fetch to "${proxiedSearchUrl}" failed (${err.message}). Ensure an intermediate CORS proxy (VITE_CORS_PROXY) is configured with Access-Control-Allow-Origin: * to bypass browser CORS restrictions.`
    };
  }

  const items = parseVegaSearch(searchJson);
  if (items.length === 0) {
    return {
      status: "not_found",
      error: `No match found on VegaMovies for "${title}"${year ? ` (${year})` : ""}.`
    };
  }

  const candidates = rankTitleCandidates(items, { title, year, type });
  if (candidates.length === 0) {
    return {
      status: "not_found",
      error: `No matching title candidate reached the relevance threshold for "${title}"${year ? ` (${year})` : ""}.`
    };
  }

  const bestCandidate = candidates[0].item;

  try {
    const proxiedPageUrl = toProxiedUrl(bestCandidate.id);
    const pageRes = await fetch(proxiedPageUrl, { signal });
    if (!pageRes.ok) {
      return {
        status: "http_error",
        httpStatus: pageRes.status,
        error: `VegaMovies detail page "${bestCandidate.id}" returned HTTP ${pageRes.status}.`
      };
    }
    const pageHtml = await pageRes.text();

    // 1. Direct media candidates on detail page
    const mediaCandidates = selectMediaCandidates(extractDirectMediaUrls(pageHtml));
    if (mediaCandidates.length > 0) {
      const picked = pickCandidateForEpisode(mediaCandidates, { season, episode });
      if (picked.url) {
        return {
          status: "provider_stream",
          url: picked.url,
          title: bestCandidate.title,
          year: bestCandidate.year,
          mediaType: picked.url.includes(".m3u8") ? "hls" : "mkv",
          sourceType: "provider",
          note: `Resolved via VegaMovies: "${bestCandidate.title}"`
        };
      }
    }

    // 2. Link pages and host links
    const linkPages = extractLinkPages(pageHtml, base);
    const hostLinks = extractHostLinks(pageHtml);
    if (linkPages.length > 0 || hostLinks.length > 0) {
      return {
        status: "unsupported_host",
        error: `VegaMovies entry found for "${bestCandidate.title}" (${bestCandidate.type}) but extracting the stream requires cross-origin third-party host unwrapping which is restricted in the browser.`
      };
    }

    return {
      status: "no_media_url",
      error: `No playable stream source or host links could be extracted from VegaMovies for "${bestCandidate.title}".`
    };
  } catch (err) {
    if (signal?.aborted || err.name === "AbortError") {
      const abortErr = new Error("Aborted");
      abortErr.name = "AbortError";
      throw abortErr;
    }
    return {
      status: "cors_blocked",
      error: `Browser CORS blocked reading VegaMovies detail page "${bestCandidate.id}" (${err.message}).`
    };
  }
}

export { toProxiedUrl };
