import { buildHomeSections, searchCinemeta, getCinemetaDetails } from "./providers/cinemeta.js";
import { resolveVegaStream } from "./providers/vegamovies.js";
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

export async function createStream(type, id, { lang, provider, season, episode, title, year, onStatus, isTestFixture = false, ...options } = {}) {
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

  // Check if test fixture mode is explicitly requested
  const isFixtureMode = isTestFixture || id === "test-fixture" || options.fixture === true;

  if (isFixtureMode) {
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

    // Attempt real VegaMovies resolution client-side
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
      // Do NOT silently substitute the test fixture!
      // Report the failure honestly as required by project rules.
      const failureReason = vegaResult.error || `No playable stream source could be resolved from VegaMovies for "${resolvedTitle}".`;
      throw new Error(failureReason);
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
