/**
 * STREAMIX 2.0 — Cloudflare Worker CORS Proxy
 *
 * Appends `Access-Control-Allow-Origin: *` to response headers, handles preflight
 * OPTIONS requests, and proxies requests to third-party movie / scraper endpoints.
 *
 * Deploy with Wrangler or paste into Cloudflare Workers Dashboard:
 * https://dash.cloudflare.com/ -> Workers & Pages -> Create Application
 */

export default {
  async fetch(request, env, ctx) {
    // 1. Handle CORS Preflight (OPTIONS)
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS, HEAD",
          "Access-Control-Allow-Headers": "*",
          "Access-Control-Max-Age": "86400"
        }
      });
    }

    // 2. Extract target URL from query parameter or path
    const urlObj = new URL(request.url);
    let targetUrl = urlObj.searchParams.get("url");

    if (!targetUrl) {
      const pathname = urlObj.pathname.slice(1);
      if (pathname.startsWith("http://") || pathname.startsWith("https://")) {
        targetUrl = pathname + urlObj.search;
      }
    }

    if (!targetUrl) {
      return new Response(
        JSON.stringify({
          error: "missing_target_url",
          usage: "Pass target URL via '?url=https://...' or '/https://...'"
        }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*"
          }
        }
      );
    }

    try {
      // 3. Clone and customize headers for third-party endpoints
      const forwardHeaders = new Headers();
      forwardHeaders.set(
        "User-Agent",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
      );
      forwardHeaders.set("Accept", request.headers.get("Accept") || "*/*");
      if (request.headers.get("Accept-Language")) {
        forwardHeaders.set("Accept-Language", request.headers.get("Accept-Language"));
      }

      // Add appropriate Referer based on target host
      try {
        const targetHost = new URL(targetUrl).origin;
        forwardHeaders.set("Referer", `${targetHost}/`);
        forwardHeaders.set("Origin", targetHost);
      } catch {
        // invalid URL handled by fetch below
      }

      const upstreamResponse = await fetch(targetUrl, {
        method: request.method,
        headers: forwardHeaders,
        body: ["GET", "HEAD"].includes(request.method) ? undefined : await request.blob(),
        redirect: "follow"
      });

      // 4. Create response with Access-Control-Allow-Origin: *
      const responseHeaders = new Headers(upstreamResponse.headers);
      responseHeaders.set("Access-Control-Allow-Origin", "*");
      responseHeaders.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS, HEAD");
      responseHeaders.set("Access-Control-Allow-Headers", "*");
      responseHeaders.set("Access-Control-Expose-Headers", "*");

      // Remove restrictive security headers that would break client viewing
      responseHeaders.delete("content-security-policy");
      responseHeaders.delete("content-security-policy-report-only");
      responseHeaders.delete("x-frame-options");

      return new Response(upstreamResponse.body, {
        status: upstreamResponse.status,
        statusText: upstreamResponse.statusText,
        headers: responseHeaders
      });
    } catch (err) {
      return new Response(
        JSON.stringify({
          error: "proxy_fetch_failed",
          message: err.message,
          targetUrl
        }),
        {
          status: 502,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*"
          }
        }
      );
    }
  }
};
