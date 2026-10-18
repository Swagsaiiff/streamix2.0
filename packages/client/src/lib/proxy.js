/**
 * STREAMIX 2.0 — CORS Proxy Helper
 *
 * Ensures all third-party scraper queries and provider resolution requests
 * pass through an intermediate CORS proxy (e.g., Cloudflare Worker or Express proxy)
 * to avoid browser-side CORS blocks.
 */

export function getCorsProxyBase() {
  if (typeof import.meta !== "undefined" && import.meta.env?.VITE_CORS_PROXY !== undefined) {
    const val = String(import.meta.env.VITE_CORS_PROXY).trim();
    if (val) return val;
  }
  if (typeof process !== "undefined" && process.env?.VITE_CORS_PROXY) {
    return String(process.env.VITE_CORS_PROXY).trim();
  }
  if (typeof window !== "undefined") {
    return "/cors-proxy?url=";
  }
  return "";
}

export function toProxiedUrl(targetUrl, proxyBase = getCorsProxyBase()) {
  if (!targetUrl || typeof targetUrl !== "string") return targetUrl;
  const trimmed = targetUrl.trim();
  if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
    return trimmed;
  }
  if (!proxyBase) {
    return trimmed;
  }

  // Already proxied?
  if (trimmed.startsWith(proxyBase)) {
    return trimmed;
  }

  if (proxyBase.endsWith("=") || proxyBase.includes("?url=")) {
    return `${proxyBase}${encodeURIComponent(trimmed)}`;
  }
  const base = proxyBase.endsWith("/") ? proxyBase : `${proxyBase}/`;
  return `${base}${encodeURIComponent(trimmed)}`;
}
