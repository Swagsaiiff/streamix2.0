import {
  Input,
  ALL_FORMATS,
  UrlSource,
  BlobSource,
  BufferSource,
  BufferTarget,
  Mp4OutputFormat,
  Conversion
} from "mediabunny";

const DIRECT_CONTAINERS = new Set(["mp4", "webm", "m4v", "mov"]);

function resolveAbsoluteUrl(url) {
  if (typeof window !== "undefined" && window.location) {
    try {
      return new URL(url, window.location.href).href;
    } catch {
      return url;
    }
  }
  return url;
}

export function isHlsUrl(url) {
  if (!url) return false;
  return /\.m3u8(\?|$)/i.test(url) || url.includes("application/vnd.apple.mpegurl");
}

export function isDirectBrowserPlayable(url) {
  if (!url) return false;
  const clean = url.split("?")[0].toLowerCase();
  const ext = clean.split(".").pop();
  return DIRECT_CONTAINERS.has(ext);
}

export async function createMediaPipeline({ sourceUrl, preferredLang = null, signal, onProgress } = {}) {
  if (!sourceUrl) {
    throw new Error("No media source URL provided");
  }

  // 1. Direct HLS stream: played via hls.js in browser
  if (isHlsUrl(sourceUrl)) {
    return {
      mode: "hls",
      playbackUrl: sourceUrl,
      audioTracks: [],
      activeTrack: null,
      videoTrack: null,
      duration: 0,
      switchAudioTrack: async () => sourceUrl,
      destroy: () => {}
    };
  }

  const absoluteUrl = resolveAbsoluteUrl(sourceUrl);

  // 2. Browser-side media inspection & processing via MediaBunny
  let input;
  let sourceRef;
  try {
    sourceRef = new UrlSource(absoluteUrl);
    input = new Input({
      source: sourceRef,
      formats: ALL_FORMATS
    });
  } catch (err) {
    throw new Error(`MediaBunny initialization failed: ${err.message}`);
  }

  let format;
  try {
    format = await input.getFormat();
  } catch (err) {
    input.dispose?.();
    const isCors = err.name === "TypeError" || /cors|failed to fetch|network|403|401/i.test(err.message);
    if (isCors) {
      throw new Error(`CORS error: Direct browser read of "${sourceUrl}" was blocked by browser CORS restrictions on the remote host.`);
    }
    throw new Error(`Media inspection failed: ${err.message}`);
  }

  if (!format) {
    input.dispose?.();
    throw new Error("Unsupported format: MediaBunny could not detect a valid media container.");
  }

  let audioTracksRaw = [];
  let videoTracksRaw = [];
  try {
    audioTracksRaw = await input.getAudioTracks();
    videoTracksRaw = await input.getVideoTracks();
  } catch (err) {
    input.dispose?.();
    throw new Error(`Failed to read media tracks: ${err.message}`);
  }

  const duration = await input.computeDuration().catch(() => input.getDurationFromMetadata().catch(() => 0));

  const audioTracks = [];
  for (let i = 0; i < audioTracksRaw.length; i += 1) {
    const t = audioTracksRaw[i];
    const name = (await t.getName().catch(() => null)) || `Audio Track ${i + 1}`;
    const lang = (await t.getLanguageCode().catch(() => null)) || "und";
    const codec = await t.getCodec().catch(() => "unknown");
    const channels = await t.getNumberOfChannels().catch(() => null);
    const sampleRate = await t.getSampleRate().catch(() => null);
    audioTracks.push({
      id: t.id,
      name,
      lang,
      codec,
      channels,
      sampleRate
    });
  }

  const videoTrackInfo = videoTracksRaw[0]
    ? {
        id: videoTracksRaw[0].id,
        codec: await videoTracksRaw[0].getCodec().catch(() => null),
        width: await videoTracksRaw[0].getDisplayWidth().catch(() => null),
        height: await videoTracksRaw[0].getDisplayHeight().catch(() => null)
      }
    : null;

  // 3. Direct browser-playable MP4/WebM:
  // If the browser can natively play the container without remuxing, return direct mode
  if (format.name.includes("MP4") || format.name.includes("WebM")) {
    return {
      mode: "direct",
      format: format.name,
      playbackUrl: absoluteUrl,
      audioTracks,
      activeTrack: audioTracks[0]?.id ?? null,
      videoTrack: videoTrackInfo,
      duration,
      switchAudioTrack: async () => absoluteUrl,
      destroy: () => {
        input.dispose?.();
      }
    };
  }

  // 4. Compatible Matroska (MKV) source:
  // Process client-side via MediaBunny remuxing to MP4 with real audio track selection!
  if (format.name.includes("Matroska") || format.name.includes("WebM")) {
    // Check video codec compatibility: H.264 / AVC or VP8 / VP9 / AV1
    const vCodec = videoTrackInfo?.codec ?? "";
    const isVideoCompatible = /avc|h264|vp8|vp9|av1/i.test(vCodec);
    if (!isVideoCompatible && vCodec) {
      input.dispose?.();
      throw new Error(`Unsupported video codec "${vCodec}": MediaBunny client-side playback requires H.264/AVC, VP8, VP9, or AV1.`);
    }

    // Determine initial audio track
    let initialTrackId = audioTracks[0]?.id ?? null;
    if (preferredLang) {
      const match = audioTracks.find((t) => t.lang === preferredLang || t.name.toLowerCase().includes(preferredLang.toLowerCase()));
      if (match) initialTrackId = match.id;
    }

    let activeObjectUrl = null;

    async function remuxWithTrack(selectedTrackId) {
      onProgress?.("remuxing", "Processing MKV client-side with MediaBunny...");
      const output = new Output({
        format: new Mp4OutputFormat(),
        target: new BufferTarget()
      });

      const conversion = await Conversion.init({
        input,
        output,
        audio: (track) => {
          if (selectedTrackId != null && audioTracks.length > 1) {
            return track.id === selectedTrackId ? {} : { discard: true };
          }
          return {};
        }
      });

      if (!conversion.isValid) {
        throw new Error(`MediaBunny remux failed: unsupported track configuration (${JSON.stringify(conversion.discardedTracks)})`);
      }

      await conversion.execute();
      const buffer = output.target.buffer;
      if (!buffer || buffer.byteLength === 0) {
        throw new Error("MediaBunny remux produced empty media buffer");
      }

      const blob = new Blob([buffer], { type: "video/mp4" });
      if (activeObjectUrl) {
        URL.revokeObjectURL(activeObjectUrl);
      }
      activeObjectUrl = URL.createObjectURL(blob);
      return activeObjectUrl;
    }

    const playbackUrl = await remuxWithTrack(initialTrackId);

    return {
      mode: "mediabunny",
      format: format.name,
      playbackUrl,
      audioTracks,
      activeTrack: initialTrackId,
      videoTrack: videoTrackInfo,
      duration,
      switchAudioTrack: async (newTrackId) => {
        return await remuxWithTrack(newTrackId);
      },
      destroy: () => {
        if (activeObjectUrl) {
          URL.revokeObjectURL(activeObjectUrl);
          activeObjectUrl = null;
        }
        input.dispose?.();
      }
    };
  }

  input.dispose?.();
  throw new Error(`Unsupported container format "${format.name}". Browser playback not supported for this media.`);
}
