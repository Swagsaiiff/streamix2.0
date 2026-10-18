import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  cleanVegaTitle,
  normalizeForMatch,
  scoreTitleMatch,
  pickBestMatch,
  rankTitleCandidates,
  parseVegaSearch,
  episodeFromUrl,
  pickCandidateForEpisode,
  hostLinkIndexForEpisode,
  resolveVegaStream
} from "../providers/vegamovies.js";
import { createStream } from "../api.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test("VegaMovies normalizeForMatch normalizes case, diacritics and whitespace", () => {
  assert.equal(normalizeForMatch("Vincenzo"), "vincenzo");
  assert.equal(normalizeForMatch("Breaking Bad: Season 1"), "breaking bad season 1");
  assert.equal(normalizeForMatch("Spider-Man: No Way Home (2021)"), "spider man no way home 2021");
  assert.equal(normalizeForMatch(""), "");
  assert.equal(normalizeForMatch(null), "");
});

test("VegaMovies scoreTitleMatch scores exact, prefix, token, and year accurately", () => {
  // Exact match
  assert.equal(scoreTitleMatch("Vincenzo", "Vincenzo", 2021, 2021), 1120); // 1000 + 120 year bonus
  assert.equal(scoreTitleMatch("Inception", "Inception", 2010, 2010), 1120);

  // Prefix match
  const prefixScore = scoreTitleMatch("Dune", "Dune Part Two", 2024, 2024);
  assert.ok(prefixScore >= 600 && prefixScore < 1000);

  // Distant year penalty
  const oldYearScore = scoreTitleMatch("Dune", "Dune", 1984, 2021);
  const correctYearScore = scoreTitleMatch("Dune", "Dune", 2021, 2021);
  assert.ok(correctYearScore > oldYearScore, "Correct year must outscore mismatched year");

  // Completely unrelated title
  assert.equal(scoreTitleMatch("Vincenzo", "The Avengers", 2012, 2021), 0);
});

test("VegaMovies rankTitleCandidates orders by score and accounts for media type", () => {
  const items = [
    { id: "1", title: "Vincenzo OST", year: 2021, type: "movie" },
    { id: "2", title: "Vincenzo", year: 2021, type: "series" },
    { id: "3", title: "Something Else", year: 2020, type: "series" }
  ];

  const ranked = rankTitleCandidates(items, { title: "Vincenzo", year: 2021, type: "series" });
  assert.ok(ranked.length >= 1);
  assert.equal(ranked[0].item.id, "2", "Exact title, year, and series type match must rank first");
});

test("VegaMovies parseVegaSearch parses valid CSX search schema", () => {
  const sampleJson = {
    hits: [
      {
        document: {
          id: "101",
          post_title: "Download Vincenzo Season 1 Dual Audio [Hindi-Korean] WEB-DL",
          permalink: "https://1vegamovies.baby/vincenzo-season-1/",
          post_thumbnail: "https://1vegamovies.baby/vincenzo.jpg"
        }
      },
      {
        document: {
          id: "102",
          post_title: "Download Inception (2010) Hindi-English 1080p BluRay",
          permalink: "https://1vegamovies.baby/inception-2010/",
          post_thumbnail: "https://1vegamovies.baby/inception.jpg"
        }
      }
    ]
  };

  const parsed = parseVegaSearch(sampleJson);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].title, "Vincenzo Season 1");
  assert.equal(parsed[0].type, "series");
  assert.equal(parsed[1].title, "Inception");
  assert.equal(parsed[1].year, 2010);
  assert.equal(parsed[1].type, "movie");
});

test("VegaMovies series episode indexing and candidate picking", () => {
  assert.equal(hostLinkIndexForEpisode(1, 1), 0);
  assert.equal(hostLinkIndexForEpisode(1, 5), 4);
  assert.equal(hostLinkIndexForEpisode(null, null), null);

  const ep = episodeFromUrl("https://example.com/Vincenzo.S01E03.720p.mkv");
  assert.deepEqual(ep, { season: 1, episode: 3 });

  const candidate = pickCandidateForEpisode(
    [
      "https://example.com/Vincenzo.S01E01.720p.mkv",
      "https://example.com/Vincenzo.S01E02.720p.mkv"
    ],
    { season: 1, episode: 2 }
  );
  assert.equal(candidate.matched, true);
  assert.equal(candidate.url, "https://example.com/Vincenzo.S01E02.720p.mkv");
});

test("resolveVegaStream diagnoses HTTP 404 distinctly from CORS", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url) => {
      if (String(url).includes("urls.json")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ vegamovies: "https://mock-vegamovies.test" })
        };
      }
      return {
        ok: false,
        status: 404,
        statusText: "Not Found",
        text: async () => "<!DOCTYPE html><html>404 Not Found</html>",
        headers: new Headers({ "content-type": "text/html" })
      };
    };

    const res = await resolveVegaStream({ title: "Vincenzo", year: 2021, type: "series" });
    assert.equal(res.status, "http_error", "HTTP 404 must be diagnosed as http_error, not cors_blocked");
    assert.equal(res.httpStatus, 404);
    assert.ok(res.error.includes("HTTP 404"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("resolveVegaStream diagnoses invalid non-JSON response content", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url) => {
      if (String(url).includes("urls.json")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ vegamovies: "https://mock-vegamovies.test" })
        };
      }
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Headers({ "content-type": "text/html; charset=UTF-8" }),
        text: async () => "<!DOCTYPE html><html>Landing Page</html>"
      };
    };

    const res = await resolveVegaStream({ title: "Vincenzo", year: 2021, type: "series" });
    assert.equal(res.status, "invalid_response", "HTML response to search.php must be diagnosed as invalid_response");
    assert.ok(res.error.includes("non-JSON content"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("resolveVegaStream diagnoses browser CORS / network failure", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url) => {
      if (String(url).includes("urls.json")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ vegamovies: "https://mock-vegamovies.test" })
        };
      }
      const err = new TypeError("Failed to fetch");
      throw err;
    };

    const res = await resolveVegaStream({ title: "Vincenzo", year: 2021, type: "series" });
    assert.equal(res.status, "cors_blocked");
    assert.ok(res.error.includes("Direct browser fetch"));
    assert.ok(res.error.includes("Access-Control-Allow-Origin"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("resolveVegaStream respects AbortSignal cleanly", async () => {
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    async () => {
      await resolveVegaStream({ title: "Vincenzo", signal: controller.signal });
    },
    { name: "AbortError" }
  );
});

test("createStream rejects real provider failure and requires explicit test mode for fixture", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url, options = {}) => {
      const urlStr = String(url);
      if (urlStr.includes("urls.json")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ vegamovies: "https://mock-vegamovies.test" })
        };
      }
      if (urlStr.includes("multi-audio-test.mkv")) {
        const fixturePath = path.resolve(__dirname, "../../public/fixtures/multi-audio-test.mkv");
        const fileBuf = fs.readFileSync(fixturePath);
        const headersObj = options.headers instanceof Headers
          ? Object.fromEntries(options.headers.entries())
          : (options.headers || {});
        const range = headersObj.range || headersObj.Range;
        if (range) {
          const m = range.match(/bytes=(\d+)-(\d*)/);
          const start = m ? parseInt(m[1], 10) : 0;
          const end = m && m[2] ? parseInt(m[2], 10) : fileBuf.length - 1;
          const slice = fileBuf.subarray(start, end + 1);
          return new Response(slice, {
            status: 206,
            headers: {
              "content-type": "video/x-matroska",
              "content-range": `bytes ${start}-${end}/${fileBuf.length}`,
              "accept-ranges": "bytes",
              "content-length": String(slice.length)
            }
          });
        }
        return new Response(fileBuf, {
          status: 200,
          headers: {
            "content-type": "video/x-matroska",
            "accept-ranges": "bytes",
            "content-length": String(fileBuf.length)
          }
        });
      }
      return {
        ok: false,
        status: 404,
        statusText: "Not Found",
        text: async () => "Not Found",
        headers: new Headers({ "content-type": "text/html" })
      };
    };

    // 1. Real title resolution must fail explicitly and not silently play fixture
    await assert.rejects(
      async () => {
        await createStream("series", "tt13130302", { title: "Vincenzo", year: 2021 });
      },
      (err) => {
        assert.ok(err.message.includes("VegaMovies resolution failed"));
        return true;
      }
    );

    // 2. Explicit test fixture mode succeeds with TEST MODE note
    const fixtureStream = await createStream("movie", "test-fixture", { isTestFixture: true });
    assert.equal(fixtureStream.sourceStatus, "fixture_fallback");
    assert.equal(fixtureStream.sourceProvider, "Test Fixture");
    assert.ok(fixtureStream.note.includes("TEST MODE"));
    fixtureStream.destroy?.();
  } finally {
    globalThis.fetch = originalFetch;
  }
});
