import { toProxiedUrl } from "../lib/proxy.js";

const DEFAULT_BASE_URL = "https://new3.moviesdrive.beer";
const DYNAMIC_URLS_ENDPOINT = "https://raw.githubusercontent.com/SaurabhKaperwan/Utils/refs/heads/main/urls.json";

let cachedBaseUrl = null;
let cachedBaseUrlExpiry = 0;

export async function getMoviesDriveBaseUrl(signal) {
  const now = Date.now();
  if (cachedBaseUrl && now < cachedBaseUrlExpiry) {
    return cachedBaseUrl;
  }

  try {
    const res = await fetch(toProxiedUrl(DYNAMIC_URLS_ENDPOINT), { signal });
    if (res.ok) {
      const data = await res.json();
      if (data && typeof data.moviesdrive === "string" && data.moviesdrive.startsWith("http")) {
        cachedBaseUrl = data.moviesdrive.replace(/\/+$/, "");
        cachedBaseUrlExpiry = now + 15 * 60 * 1000;
        return cachedBaseUrl;
      }
    }
  } catch {
    // Fall back to default on network or parse failure
  }

  cachedBaseUrl = DEFAULT_BASE_URL;
  cachedBaseUrlExpiry = now + 5 * 60 * 1000;
  return cachedBaseUrl;
}

export function normalizeTitle(str) {
  if (!str) return "";
  return str
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function scoreTitleMatch(candidateTitle, queryTitle, candidateYear, queryYear) {
  const cNorm = normalizeTitle(candidateTitle);
  const qNorm = normalizeTitle(queryTitle);

  if (!cNorm || !qNorm) return 0;
  let score = 0;

  if (cNorm === qNorm) {
    score += 1000;
  } else if (cNorm.startsWith(qNorm)) {
    score += 800;
  } else if (cNorm.includes(qNorm)) {
    score += 600;
  } else {
    const qTokens = qNorm.split(" ").filter((t) => t.length > 2);
    const cTokens = new Set(cNorm.split(" "));
    let matched = 0;
    for (const t of qTokens) {
      if (cTokens.has(t)) matched++;
    }
    if (qTokens.length > 0 && matched === qTokens.length) {
      score += 450;
    } else if (matched > 0) {
      score += Math.round((matched / qTokens.length) * 300);
    }
  }

  if (candidateYear && queryYear) {
    const cY = parseInt(candidateYear, 10);
    const qY = parseInt(queryYear, 10);
    if (!isNaN(cY) && !isNaN(qY)) {
      if (cY === qY) score += 200;
      else if (Math.abs(cY - qY) === 1) score += 80;
      else score -= 100;
    }
  }

  return score;
}

export async function searchMoviesDrive(query, { signal } = {}) {
  const base = await getMoviesDriveBaseUrl(signal);
  const searchUrl = `${base}/search.php?q=${encodeURIComponent(query)}&page=1`;
  const proxied = toProxiedUrl(searchUrl);

  const res = await fetch(proxied, { signal });
  if (!res.ok) {
    throw new Error(`MoviesDrive search returned HTTP ${res.status}`);
  }

  const data = await res.json();
  const hits = Array.isArray(data?.hits) ? data.hits : [];
  return hits.map((hit) => ({
    title: hit.document?.post_title || "",
    permalink: hit.document?.permalink || "",
    imdbId: hit.document?.imdb_id || "",
    category: hit.document?.category || [],
    posterUrl: hit.document?.post_thumbnail || ""
  }));
}

export function extractDownloadLinks(html) {
  const links = [];
  const regex = /<h5[^>]*>[\s\S]*?<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    const href = match[1];
    const text = match[2].replace(/<[^>]+>/g, "").trim();
    if (href && !text.toLowerCase().includes("zip")) {
      links.push({ href, text });
    }
  }
  return links;
}

export function extractHubCloudLink(archiveHtml) {
  const match = archiveHtml.match(/href=["'](https?:\/\/[^"']*hubcloud[^"']*)["']/i);
  return match ? match[1] : null;
}

export function extractNextHubUrl(hubHtml) {
  const match = hubHtml.match(/var\s+url\s*=\s*['"]([^'"]+)['"]/);
  return match ? match[1] : null;
}

export async function resolveFinalMediaUrl(startUrl, { signal } = {}) {
  let currentUrl = startUrl;
  let count = 0;
  const maxRedirects = 6;

  while (count < maxRedirects) {
    if (signal?.aborted) throw new Error("Aborted");
    try {
      const res = await fetch(toProxiedUrl(currentUrl), {
        method: "GET",
        headers: { Referer: currentUrl },
        redirect: "manual",
        signal
      });

      const location = res.headers.get("location");
      if (location) {
        if (location.includes("link=")) {
          const direct = location.split("link=")[1];
          return decodeURIComponent(direct);
        }
        currentUrl = location;
        count++;
        continue;
      }

      // Check text for cryptonewz or direct link
      const text = await res.text();
      const linkParam = text.match(/dl\.php\?link=([^"'\s&]+)/i);
      if (linkParam) {
        return decodeURIComponent(linkParam[1]);
      }

      // Look for download buttons
      const btnMatch = text.match(/href=["'](https?:\/\/[^"']*(?:googleusercontent|workers\.dev|cryptonewz)[^"']*)["']/i);
      if (btnMatch) {
        if (btnMatch[1].includes("link=")) {
          return decodeURIComponent(btnMatch[1].split("link=")[1]);
        }
        currentUrl = btnMatch[1];
        count++;
        continue;
      }

      break;
    } catch {
      break;
    }
  }

  if (currentUrl.includes("link=")) {
    return decodeURIComponent(currentUrl.split("link=")[1]);
  }
  if (currentUrl.includes("pixeldrain.") && currentUrl.includes("/u/")) {
    return currentUrl.replace("/u/", "/api/file/");
  }
  return currentUrl;
}

export async function resolveMoviesDriveStream({
  title,
  year,
  type = "movie",
  season = null,
  episode = null,
  imdbId = null,
  signal
} = {}) {
  if (signal?.aborted) {
    const err = new Error("Aborted");
    err.name = "AbortError";
    throw err;
  }

  const base = await getMoviesDriveBaseUrl(signal);
  const candidates = await searchMoviesDrive(title, { signal });

  if (candidates.length === 0) {
    return {
      status: "not_found",
      error: `No titles found on MoviesDrive for "${title}".`
    };
  }

  // Rank candidates
  const scored = candidates.map((c) => {
    let score = scoreTitleMatch(c.title, title, null, year);
    if (imdbId && c.imdbId && c.imdbId.toLowerCase() === imdbId.toLowerCase()) {
      score += 1500;
    }
    const isSeries = /season|series|episode/i.test(c.title);
    if (type === "series" && isSeries) score += 200;
    if (type === "movie" && !isSeries) score += 200;
    return { ...c, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];

  if (!best || best.score < 300) {
    return {
      status: "not_found",
      error: `No confident match found on MoviesDrive for "${title}" (best score: ${best?.score || 0}).`
    };
  }

  // Fetch detail page
  const detailUrl = best.permalink.startsWith("http") ? best.permalink : `${base}${best.permalink}`;
  const detailRes = await fetch(toProxiedUrl(detailUrl), { signal });
  if (!detailRes.ok) {
    return {
      status: "http_error",
      error: `Failed to fetch detail page from MoviesDrive: HTTP ${detailRes.status}`
    };
  }

  const detailHtml = await detailRes.text();
  const downloadLinks = extractDownloadLinks(detailHtml);

  if (downloadLinks.length === 0) {
    return {
      status: "unsupported_media",
      error: `Found post "${best.title}" on MoviesDrive, but no download links could be parsed.`
    };
  }

  // Select 720p or 480p or first link
  let chosenLink = downloadLinks.find((l) => /720p|1080p/i.test(l.text)) || downloadLinks[0];

  // Fetch archive link page
  const archiveRes = await fetch(toProxiedUrl(chosenLink.href), { signal });
  if (!archiveRes.ok) {
    return {
      status: "http_error",
      error: `Failed to fetch archive link page: HTTP ${archiveRes.status}`
    };
  }

  const archiveHtml = await archiveRes.text();
  const hubLink = extractHubCloudLink(archiveHtml);

  if (!hubLink) {
    return {
      status: "unsupported_media",
      error: `No HubCloud drive links found in archive for "${best.title}".`
    };
  }

  // Fetch HubCloud drive page
  const hubRes = await fetch(toProxiedUrl(hubLink), { signal });
  if (!hubRes.ok) {
    return {
      status: "http_error",
      error: `Failed to fetch HubCloud drive page: HTTP ${hubRes.status}`
    };
  }

  const hubHtml = await hubRes.text();
  const nextHubUrl = extractNextHubUrl(hubHtml);

  if (!nextHubUrl) {
    return {
      status: "unsupported_media",
      error: `Could not extract next download link from HubCloud drive page.`
    };
  }

  // Fetch generator page (gamerxyt.com...)
  const genRes = await fetch(toProxiedUrl(nextHubUrl), { signal });
  if (!genRes.ok) {
    return {
      status: "http_error",
      error: `Failed to reach download link generator: HTTP ${genRes.status}`
    };
  }

  const genHtml = await genRes.text();
  const serverBtn =
    genHtml.match(/href=["'](https?:\/\/[^"']*pixel\.hubcloud[^"']*[?&](?:id|link)=[^"']*)["']/i) ||
    genHtml.match(/href=["'](https?:\/\/[^"']*(?:cloudflarestorage\.com|googleusercontent\.com|gpdl\.hubcloud|dl\.php\?link=)[^"']*)["']/i) ||
    genHtml.match(/href=["'](https?:\/\/[^"']*(?:snvhost)[^"']*[?&](?:id|link)=[^"']*)["']/i) ||
    genHtml.match(/href=["'](https?:\/\/[^"']*pixeldrain\.(?:dev|com)\/(?:api\/file\/|u\/)[^"']*)["']/i);

  if (!serverBtn) {
    return {
      status: "unsupported_media",
      error: `No direct 10Gbps stream server link available for "${best.title}".`
    };
  }

  // Resolve final direct media link
  const finalMediaUrl = await resolveFinalMediaUrl(serverBtn[1], { signal });

  if (!finalMediaUrl || !finalMediaUrl.startsWith("http")) {
    return {
      status: "unsupported_media",
      error: `Could not resolve final media stream URL for "${best.title}".`
    };
  }

  // Disallow bare domain landing pages (like https://snvhost.com/)
  try {
    const parsed = new URL(finalMediaUrl);
    if ((parsed.pathname === "/" || parsed.pathname === "") && !parsed.search) {
      return {
        status: "unsupported_media",
        error: `Resolved URL is a website homepage ("${finalMediaUrl}"), not a video stream.`
      };
    }
  } catch {
    // ignore
  }

  const isHls = /\.m3u8/i.test(finalMediaUrl);
  const isMkv = /\.mkv/i.test(finalMediaUrl) || /filename=[^&]*\.mkv/i.test(finalMediaUrl);

  return {
    status: "provider_stream",
    url: toProxiedUrl(finalMediaUrl),
    rawUrl: finalMediaUrl,
    mediaType: isHls ? "hls" : isMkv ? "mkv" : "mp4",
    sourceType: "moviesdrive",
    sourceProvider: "MoviesDrive (Hindi Dual Audio)",
    note: `${best.title} · Quality: ${chosenLink.text}`
  };
}
