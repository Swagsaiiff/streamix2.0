import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeTitle,
  scoreTitleMatch,
  extractDownloadLinks,
  extractHubCloudLink,
  extractNextHubUrl,
  resolveFinalMediaUrl
} from "../providers/moviesdrive.js";

test("MoviesDrive normalizeTitle normalizes case, diacritics and punctuation", () => {
  assert.equal(normalizeTitle("Inception (2010)"), "inception 2010");
  assert.equal(normalizeTitle("Stree 2: Sarkate Ka Aatank"), "stree 2 sarkate ka aatank");
  assert.equal(normalizeTitle("   Vincenzo   --  Season 1 "), "vincenzo season 1");
});

test("MoviesDrive scoreTitleMatch scores accurately", () => {
  const exact = scoreTitleMatch("Inception", "Inception", 2010, 2010);
  const partial = scoreTitleMatch("Inception 2010 Dual Audio", "Inception", 2010, 2010);
  const mismatch = scoreTitleMatch("Interstellar (2014)", "Inception", 2014, 2010);

  assert.ok(exact > partial, "Exact match must outscore partial match");
  assert.ok(partial > mismatch, "Partial match must outscore mismatch");
  assert.ok(exact >= 1000, "Exact match with year bonus should be >= 1000");
});


test("MoviesDrive extractDownloadLinks parses download buttons from HTML", () => {
  const sampleHtml = `
    <h5 style="text-align: center;">
      <a href="https://mdrive.lol/archive/1001/" target="_blank" rel="noopener">480p [500MB]</a>
    </h5>
    <h5 style="text-align: center;">
      <a href="https://mdrive.lol/archive/1002/" target="_blank" rel="noopener">720p [1.2GB]</a>
    </h5>
    <h5 style="text-align: center;">
      <a href="https://mdrive.lol/archive/1003/" target="_blank" rel="noopener">Batch Zip [3GB]</a>
    </h5>
  `;

  const links = extractDownloadLinks(sampleHtml);
  assert.equal(links.length, 2, "Must filter out zip links and extract real buttons");
  assert.equal(links[0].text, "480p [500MB]");
  assert.equal(links[0].href, "https://mdrive.lol/archive/1001/");
  assert.equal(links[1].text, "720p [1.2GB]");
  assert.equal(links[1].href, "https://mdrive.lol/archive/1002/");
});

test("MoviesDrive extractHubCloudLink and extractNextHubUrl parse host URLs", () => {
  const archiveHtml = `<div><a href="https://hubcloud.ist/drive/abc123xyz">Download File</a></div>`;
  assert.equal(extractHubCloudLink(archiveHtml), "https://hubcloud.ist/drive/abc123xyz");

  const hubHtml = `
    <script>
      var url = 'https://gamerxyt.com/hubcloud.php?host=hubcloud&id=abc123xyz&token=secret';
    </script>
  `;
  assert.equal(
    extractNextHubUrl(hubHtml),
    "https://gamerxyt.com/hubcloud.php?host=hubcloud&id=abc123xyz&token=secret"
  );
});

test("MoviesDrive resolveFinalMediaUrl extracts direct stream link from redirect", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({
      headers: {
        get: (h) =>
          h.toLowerCase() === "location"
            ? "https://cryptonewz.online/dl.php?link=https%3A%2F%2Fvideo-downloads.googleusercontent.com%2Fstream.mkv"
            : null
      },
      text: async () => ""
    });

    const direct = await resolveFinalMediaUrl("https://pixel.hubcloud.ist/?id=test");
    assert.equal(direct, "https://video-downloads.googleusercontent.com/stream.mkv");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
