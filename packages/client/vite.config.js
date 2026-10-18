import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { Readable } from "node:stream";

function localCorsProxyPlugin() {
  const handler = async (req, res) => {
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "*",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Max-Age": "86400"
      });
      res.end();
      return;
    }

    const urlObj = new URL(req.url, "http://localhost");
    const targetUrl = urlObj.searchParams.get("url");
    if (!targetUrl) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing url parameter" }));
      return;
    }

    try {
      const forwardHeaders = {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        Referer: new URL(targetUrl).origin + "/"
      };

      if (req.headers.range) {
        forwardHeaders.range = req.headers.range;
      }
      if (req.headers.accept) {
        forwardHeaders.accept = req.headers.accept;
      }

      const upstream = await fetch(targetUrl, {
        method: req.method,
        headers: forwardHeaders
      });

      const responseHeaders = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "*",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Expose-Headers": "*"
      };

      for (const [key, val] of upstream.headers) {
        const lower = key.toLowerCase();
        // Never forward compressed content-length or content-encoding because Node fetch()
        // automatically decompresses the body, making the upstream content-length too short!
        if (lower === "content-length" && upstream.headers.get("content-encoding")) {
          continue;
        }
        if (lower === "content-encoding") {
          continue;
        }
        if (
          [
            "content-type",
            "content-length",
            "content-range",
            "accept-ranges",
            "content-disposition"
          ].includes(lower)
        ) {
          responseHeaders[key] = val;
        }
      }


      res.writeHead(upstream.status, responseHeaders);

      if (upstream.body) {
        Readable.fromWeb(upstream.body).pipe(res);
      } else {
        res.end();
      }
    } catch (err) {
      res.writeHead(502, {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json"
      });
      res.end(JSON.stringify({ error: err.message, targetUrl }));
    }
  };

  return {
    name: "local-cors-proxy",
    configureServer(server) {
      server.middlewares.use("/cors-proxy", handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use("/cors-proxy", handler);
    }
  };
}

export default defineConfig({
  plugins: [react(), localCorsProxyPlugin()]
});
