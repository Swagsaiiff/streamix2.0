import { buildHomeSections, searchCinemeta, getCinemetaDetails } from "./providers/cinemeta.js";
import { resolveVegaStream } from "./providers/vegamovies.js";
import { resolveStremioStream, getStremioAddonUrl } from "./providers/stremio.js";
import { resolveMoviesDriveStream } from "./providers/moviesdrive.js";
import { createMediaPipeline } from "./media/pipeline.js";

const FIXTURE_FALLBACK_URL = "/fixtures/multi-audio-test.mkv";

export async function fetchHomeSections(options = {}) {
  return await buildHomeSections(options?.signal);
}

export async function fetchSearch(q, options = {}) {
  const items = await searchCinemeta(q, options?.signal);
  return {
    query: q,
    count: items.length,
    items
  };
}

export async function fetchDetail(type, id, options = {}) {
  const item = await getCinemetaDetails(type, id, options?.signal);
  return { item };
}

export async function createStream(type, id, { lang, provider, season, episode, title, year, onStatus, isTestFixture = false, customStreamUrl = null, stremioAddonUrl = null, ...options } = {}) {
  if (options.signal?.aborted) {
    const err = new Error("Aborted");
    err.name = "AbortError";
    throw err;
  }

  let sourceUrl = null;
  let sourceStatus = "provider_stream";
  let streamNote = null;
  let sourceProvider = provider ?? "MediaBunny";
  let resolvedTitle = title;
  let resolvedYear = year;

  // 1. Direct custom stream URL (e.g. user pasted a working .mp4 / .m3u8 / .mkv stream)
  if (customStreamUrl && typeof customStreamUrl === "string" && customStreamUrl.trim()) {
    sourceUrl = customStreamUrl.trim();
    sourceStatus = "provider_stream";
    sourceProvider = "Custom URL";
    streamNote = "Playing custom stream source.";
    resolvedTitle = resolvedTitle || "Custom Stream";
  }
  // 2. Explicit test fixture mode
  else if (isTestFixture || id === "test-fixture" || options.fixture === true) {
    sourceUrl = FIXTURE_FALLBACK_URL;
    sourceStatus = "fixture_fallback";
    sourceProvider = "Test Fixture";
    streamNote = "TEST MODE: Playing local multi-audio fixture (MediaBunny test pipeline).";
    resolvedTitle = resolvedTitle || "STREAMIX Multi-Audio Test Fixture";
  } else {
    // Real movie or series title resolution
    if (!resolvedTitle) {
      try {
        const detail = await getCinemetaDetails(type, id, options.signal);
        resolvedTitle = detail.title;
        resolvedYear = detail.year;
      } catch (err) {
        if (options.signal?.aborted || err.name === "AbortError") {
          const abortErr = new Error("Aborted");
          abortErr.name = "AbortError";
          throw abortErr;
        }
        resolvedTitle = id;
      }
    }

    if (options.signal?.aborted) {
      const err = new Error("Aborted");
      err.name = "AbortError";
      throw err;
    }

    onStatus?.("resolving", `Resolving stream for "${resolvedTitle}"...`);

    // Check if a Stremio stream addon is configured
    const activeStremioAddon = stremioAddonUrl || getStremioAddonUrl();
    if (activeStremioAddon) {
      onStatus?.("resolving", `Querying Stremio addon for "${resolvedTitle}"...`);
      const stremioRes = await resolveStremioStream({
        type,
        id,
        season,
        episode,
        signal: options.signal,
        addonBase: activeStremioAddon
      });

      if (stremioRes.status === "provider_stream" && stremioRes.url) {
        sourceUrl = stremioRes.url;
        sourceStatus = "provider_stream";
        sourceProvider = "Stremio Addon";
        streamNote = stremioRes.note;
      }
    }

    // 2. Query MoviesDrive (Hindi Dubbed & Bollywood CSX Provider)
    let moviesDriveError = null;
    if (!sourceUrl) {
      try {
        onStatus?.("resolving", `Searching MoviesDrive (Hindi Dual Audio) for "${resolvedTitle}"...`);
        const mdResult = await resolveMoviesDriveStream({
          title: resolvedTitle,
          year: resolvedYear,
          type,
          season,
          episode,
          imdbId: id,
          signal: options.signal
        });

        if (mdResult.status === "provider_stream" && (mdResult.rawUrl || mdResult.url)) {
          const directStreamUrl = mdResult.rawUrl || mdResult.url;
          // Always stream through the FFmpeg backend server for on-the-fly HLS progressive playback!
          onStatus?.("transcoding", "Connecting to STREAMIX FFmpeg backend for live HLS streaming...");
          try {
            const transcodeRes = await fetch(`/api/stream/${type}/${id}`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                sourceUrl: directStreamUrl,
                title: resolvedTitle,
                year: resolvedYear,
                season,
                episode,
                providerName: mdResult.sourceProvider || "MoviesDrive (FFmpeg HLS)"
              }),
              signal: options.signal
            });

            if (transcodeRes.ok) {
              const sessionData = await transcodeRes.json();
              if (sessionData.playlistUrl) {
                // Return HLS stream directly to Player.jsx! No MediaBunny download into browser RAM!
                return {
                  sessionId: sessionData.sessionId,
                  streamMode: "hls",
                  playlistUrl: sessionData.playlistUrl,
                  playbackUrl: sessionData.playlistUrl,
                  audioTracks: (sessionData.audioTracks || []).map((t) => ({
                    id: t.trackId,
                    name: t.name,
                    lang: t.language || "und",
                    codec: t.codec || "aac"
                  })),
                  provider: { name: sessionData.provider?.name || "MoviesDrive (FFmpeg HLS)", resolution: "provider_stream" },
                  resolution: { status: "provider_stream" },
                  sourceStatus: "provider_stream",
                  sourceProvider: sessionData.provider?.name || "MoviesDrive (FFmpeg HLS)",
                  status: "ready",
                  title: resolvedTitle,
                  year: resolvedYear,
                  note: `${mdResult.note || resolvedTitle} · Live FFmpeg HLS stream`,
                  switchAudioTrack: async () => sessionData.playlistUrl,
                  destroy: () => cleanupStream(sessionData.sessionId)
                };
              } else {
                moviesDriveError = "Server transcoding session returned no playlist URL.";
              }
            } else {
              const errBody = await transcodeRes.json().catch(() => null);
              moviesDriveError = `FFmpeg backend error (${transcodeRes.status}): ${errBody?.message || "Transcoding failed"}`;
            }
          } catch (backendErr) {
            if (options.signal?.aborted || backendErr.name === "AbortError") throw backendErr;
            moviesDriveError = `Could not reach STREAMIX backend on port 4000 (${backendErr.message}). Start the server with "npm run dev:all" or "npm run start".`;
          }
        } else {
          moviesDriveError = mdResult.error || `Title "${resolvedTitle}" is not available in MoviesDrive's catalog.`;
        }
      } catch (mdErr) {
        if (options.signal?.aborted || mdErr.name === "AbortError") {
          const abortErr = new Error("Aborted");
          abortErr.name = "AbortError";
          throw abortErr;
        }
        moviesDriveError = mdErr.message;
      }
    }

    // 3. If no stream resolved via MoviesDrive or Stremio, attempt VegaMovies client-side
    if (!sourceUrl) {
      const vegaResult = await resolveVegaStream({
        title: resolvedTitle,
        year: resolvedYear,
        type,
        season,
        episode,
        signal: options.signal
      });

      if (options.signal?.aborted) {
        const err = new Error("Aborted");
        err.name = "AbortError";
        throw err;
      }

      if (vegaResult.status === "provider_stream" && vegaResult.url) {
        sourceUrl = vegaResult.url;
        sourceStatus = "provider_stream";
        sourceProvider = "VegaMovies";
        streamNote = vegaResult.note;
      } else {
        // Report provider results honestly without silent substitution
        const vegaReason = vegaResult.error || "VegaMovies resolution failed: endpoint unreachable.";
        throw new Error(
          `${vegaReason} (MoviesDrive: ${moviesDriveError || "Not found in catalog"}. Use "Custom Stream / Addon" to enter a stream URL or Stremio addon.)`
        );
      }
    }
  }

  if (options.signal?.aborted) {
    const err = new Error("Aborted");
    err.name = "AbortError";
    throw err;
  }

  onStatus?.("inspecting", "Inspecting media client-side with MediaBunny...");

  // Initialize MediaBunny playback pipeline
  const pipeline = await createMediaPipeline({
    sourceUrl,
    preferredLang: lang,
    signal: options.signal,
    onProgress: (status, message) => onStatus?.(status, message)
  });

  return {
    sessionId: `mb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    pipeline,
    provider: { name: sourceProvider, resolution: sourceStatus },
    resolution: { status: sourceStatus },
    sourceStatus,
    sourceProvider,
    status: "ready",
    streamMode: pipeline.mode,
    playlistUrl: pipeline.playbackUrl,
    playbackUrl: pipeline.playbackUrl,
    audioTracks: pipeline.audioTracks,
    activeTrack: pipeline.activeTrack,
    note: streamNote,
    title: resolvedTitle,
    year: resolvedYear,
    switchAudioTrack: pipeline.switchAudioTrack,
    destroy: pipeline.destroy
  };
}

export function cleanupStream(_sessionId) {
  return Promise.resolve({ status: "cleaned" });
}
