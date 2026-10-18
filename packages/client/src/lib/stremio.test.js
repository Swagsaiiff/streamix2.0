import test from "node:test";
import assert from "node:assert/strict";
import { resolveStremioStream, getStremioAddonUrl, setStremioAddonUrl } from "../providers/stremio.js";
import { createStream } from "../api.js";

test("resolveStremioStream returns unconfigured when no addon URL exists", async () => {
  const res = await resolveStremioStream({
    type: "movie",
    id: "tt1375666",
    addonBase: ""
  });
  assert.equal(res.status, "unconfigured");
  assert.ok(res.error.includes("No Stremio stream addon configured"));
});

test("resolveStremioStream formats movie and series URLs according to Stremio Addon Protocol v3", async () => {
  const originalFetch = globalThis.fetch;
  const requestedUrls = [];

  try {
    globalThis.fetch = async (url) => {
      requestedUrls.push(String(url));
      return {
        ok: true,
        status: 200,
        json: async () => ({
          streams: [
            {
              name: "1080p Stream",
              title: "English Audio AAC",
              url: "https://mock-cdn.test/inception-1080p.mp4"
            }
          ]
        })
      };
    };

    // 1. Movie test
    const movieRes = await resolveStremioStream({
      type: "movie",
      id: "tt1375666",
      addonBase: "https://my-addon.test"
    });
    assert.equal(movieRes.status, "provider_stream");
    assert.equal(movieRes.mediaType, "mp4");
    assert.equal(movieRes.url, "https://mock-cdn.test/inception-1080p.mp4");
    assert.ok(requestedUrls[0].includes("https://my-addon.test/stream/movie/tt1375666.json"));

    // 2. Series test (season & episode indexing)
    const seriesRes = await resolveStremioStream({
      type: "series",
      id: "tt13433812",
      season: 1,
      episode: 5,
      addonBase: "https://my-addon.test/manifest.json"
    });
    assert.equal(seriesRes.status, "provider_stream");
    assert.ok(requestedUrls[1].includes("https://my-addon.test/stream/series/tt13433812%3A1%3A5.json"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("createStream accepts custom stream URLs directly and bypasses provider scrapers", async () => {
  const customUrl = "https://mock-cdn.test/stream/master.m3u8";
  const stream = await createStream("movie", "tt1375666", {
    customStreamUrl: customUrl
  });

  assert.equal(stream.sourceStatus, "provider_stream");
  assert.equal(stream.sourceProvider, "Custom URL");
  assert.equal(stream.playlistUrl, customUrl);
  stream.destroy?.();
});

