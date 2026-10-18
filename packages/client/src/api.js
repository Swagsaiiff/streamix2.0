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

export async function createStream(type, id, { lang, provider, season, episode, title, year, onStatus, ...options } = {}) {
  let sourceUrl = null;
  let sourceStatus = "provider_stream";
  let streamNote = null;
  let sourceProvider = provider ?? "MediaBunny";

  // If a title was not provided directly in options, look up detail to get real title & year
  let resolvedTitle = title;
  let resolvedYear = year;
  if (!resolvedTitle) {
    try {
      const detail = await getCinemetaDetails(type, id, options?.signal);
      resolvedTitle = detail.title;
      resolvedYear = detail.year;
    } catch {
      resolvedTitle = id;
    }
  }

  // Attempt real VegaMovies resolution client-side
  try {
    const vegaResult = await resolveVegaStream({
      title: resolvedTitle,
      year: resolvedYear,
      type,
      season,
      episode,
      signal: options?.signal
    });

    if (vegaResult.status === "provider_stream" && vegaResult.url) {
      sourceUrl = vegaResult.url;
      sourceStatus = "provider_stream";
      sourceProvider = "VegaMovies";
      streamNote = vegaResult.note;
    } else {
      // Direct VegaMovies scraping failed (e.g. CORS restriction on third-party host)
      // Fall back honestly to the multi-audio test fixture
      sourceUrl = FIXTURE_FALLBACK_URL;
      sourceStatus = "fixture_fallback";
      streamNote = vegaResult.error
        ? `TEST MODE: ${vegaResult.error} — Playing test fixture with MediaBunny.`
        : `TEST MODE: VegaMovies match not playable — Playing test fixture with MediaBunny.`;
    }
  } catch (err) {
    sourceUrl = FIXTURE_FALLBACK_URL;
    sourceStatus = "fixture_fallback";
    streamNote = `TEST MODE: Direct resolution error (${err.message}) — Playing test fixture with MediaBunny.`;
  }

  onStatus?.("inspecting", "Inspecting media client-side with MediaBunny...");

  // Initialize MediaBunny playback pipeline
  const pipeline = await createMediaPipeline({
    sourceUrl,
    preferredLang: lang,
    signal: options?.signal,
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
