/**
 * STREAMIX 2.0 — Stremio Stream Provider
 *
 * Implements the standard Stremio Add-on Protocol (v3):
 * GET {addonUrl}/stream/{type}/{id}.json
 *
 * Supports direct HTTP/HLS streams from any compliant Stremio streaming addon
 * (e.g. HTTP stream addons, debrid addons, or custom endpoints).
 */

import { toProxiedUrl } from "../lib/proxy.js";

export function getStremioAddonUrl() {
  if (typeof window !== "undefined") {
    const saved = localStorage.getItem("streamix.stremio_addon");
    if (saved && saved.trim()) return saved.trim();
  }
  if (typeof import.meta !== "undefined" && import.meta.env?.VITE_STREMIO_STREAM_ADDON) {
    return String(import.meta.env.VITE_STREMIO_STREAM_ADDON).trim();
  }
  return "";
}

export function setStremioAddonUrl(url) {
  if (typeof window !== "undefined") {
    if (url && typeof url === "string" && url.trim()) {
      localStorage.setItem("streamix.stremio_addon", url.trim());
    } else {
      localStorage.removeItem("streamix.stremio_addon");
    }
  }
}

export async function resolveStremioStream({
  type,
  id,
  season = null,
  episode = null,
  signal,
  addonBase = getStremioAddonUrl()
}) {
  if (signal?.aborted) {
    const err = new Error("Aborted");
    err.name = "AbortError";
    throw err;
  }

  if (!addonBase) {
    return {
      status: "unconfigured",
      error: "No Stremio stream addon configured. Set VITE_STREMIO_STREAM_ADDON in .env or configure an addon URL in player settings."
    };
  }

  // Clean base URL: strip /manifest.json or trailing slashes if present
  const cleanBase = addonBase.replace(/\/manifest\.json$/i, "").replace(/\/+$/, "");

  // Stremio ID format:
  // Movies: tt1375666
  // Series: tt13433812:1:1
  const stremioId =
    type === "series" && season != null && episode != null
      ? `${id}:${season}:${episode}`
      : id;

  const endpoint = `${cleanBase}/stream/${type}/${encodeURIComponent(stremioId)}.json`;
  const proxiedEndpoint = toProxiedUrl(endpoint);

  try {
    const res = await fetch(proxiedEndpoint, { signal });
    if (!res.ok) {
      return {
        status: "http_error",
        error: `Stremio addon returned HTTP ${res.status} (${res.statusText || "Error"}) for "${endpoint}".`
      };
    }
    const data = await res.json();
    const streams = data?.streams || [];
    if (!Array.isArray(streams) || streams.length === 0) {
      return {
        status: "not_found",
        error: `No streams returned by Stremio addon for ${type} "${stremioId}".`
      };
    }

    // Find first playable stream with direct URL
    const playable = streams.find((s) => typeof s.url === "string" && s.url.startsWith("http"));
    if (!playable) {
      return {
        status: "unsupported_stream",
        error: `Stremio addon returned ${streams.length} stream(s), but none contain direct HTTP/HLS playback URLs (e.g. torrent infoHashes only).`
      };
    }

    const isHls = playable.url.includes(".m3u8");
    const isMkv = playable.url.includes(".mkv");

    return {
      status: "provider_stream",
      url: toProxiedUrl(playable.url),
      mediaType: isHls ? "hls" : isMkv ? "mkv" : "mp4",
      sourceType: "stremio",
      sourceProvider: cleanBase,
      note: playable.name || playable.title || "Stremio Stream"
    };
  } catch (err) {
    if (signal?.aborted || err.name === "AbortError") {
      const abortErr = new Error("Aborted");
      abortErr.name = "AbortError";
      throw abortErr;
    }
    return {
      status: "network_error",
      error: `Failed to fetch Stremio addon streams from "${proxiedEndpoint}": ${err.message}`
    };
  }
}
