# STREAMIX 2.0 — Cloudflare Worker CORS Proxy

This Cloudflare Worker handles CORS headers for third-party scrapers and stream resolution in STREAMIX 2.0.

## Features
- Appends `Access-Control-Allow-Origin: *` to all proxied responses.
- Handles preflight `OPTIONS` requests instantly.
- Injects standard browser headers (`User-Agent`, `Referer`, `Origin`) to bypass basic anti-scraping checks.
- Strips restrictive CSP and framing headers so client can inspect media.

## Deploying to Cloudflare (Free)

### Method 1: Cloudflare Dashboard (Fastest, No CLI required)
1. Go to [dash.cloudflare.com](https://dash.cloudflare.com/).
2. Navigate to **Workers & Pages** → **Create application** → **Create Worker**.
3. Name it `streamix-cors-proxy` and click **Deploy**.
4. Click **Edit code**, paste the contents of `cors-proxy-worker.js`, and click **Deploy**.
5. Copy your worker URL (e.g., `https://streamix-cors-proxy.<your-subdomain>.workers.dev`).

### Method 2: Cloudflare Wrangler CLI
```bash
cd cloudflare-worker
npx wrangler login
npx wrangler deploy
```

## Configuring STREAMIX
In `packages/client/.env`:
```env
VITE_CORS_PROXY=https://streamix-cors-proxy.<your-subdomain>.workers.dev/?url=
```
