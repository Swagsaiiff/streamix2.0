import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

function localCorsProxyPlugin() {
  const handler = async (req, res) => {
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "*",
        "Access-Control-Allow-Headers": "*"
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
      const upstream = await fetch(targetUrl, {
        method: req.method,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
          Referer: new URL(targetUrl).origin + "/"
        }
      });

      const headers = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "*",
        "Access-Control-Allow-Headers": "*"
      };
      const ct = upstream.headers.get("content-type");
      if (ct) headers["Content-Type"] = ct;

      res.writeHead(upstream.status, headers);
      const buf = await upstream.arrayBuffer();
      res.end(Buffer.from(buf));
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
