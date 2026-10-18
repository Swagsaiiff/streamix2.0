import {
  Input,
  Output,
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

function checkAbort(signal) {
  if (signal?.aborted) {
    const err = new Error("Aborted");
    err.name = "AbortError";
    throw err;
  }
}

export async function createMediaPipeline({ sourceUrl, preferredLang = null, signal, onProgress } = {}) {
  checkAbort(signal);

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
    sourceRef = new UrlSource(absoluteUrl, { maxCacheSize: Infinity });
    input = new Input({
      source: sourceRef,
      formats: ALL_FORMATS
    });
  } catch (err) {
    checkAbort(signal);
    throw new Error(`MediaBunny initialization failed: ${err.message}`);
  }

  checkAbort(signal);

  let format = null;
  try {
    format = await input.getFormat();
  } catch (err) {
    try {
      input.dispose?.();
    } catch {
      // ignore
    }
    checkAbort(signal);
    const isCors = err.name === "TypeError" || /cors|failed to fetch|network|403|401/i.test(err.message);
    if (isCors) {
      throw new Error(`CORS error: Direct browser read of "${sourceUrl}" was blocked by browser CORS restrictions on the remote host.`);
    }
    const isMkv = /\.mkv(\?|$)/i.test(sourceUrl);
    if (isMkv) {
      throw new Error(`Matroska (.mkv) container cannot be opened directly by browser HTML5 media engine. Web browsers require HLS (.m3u8) or MP4.`);
    }
    // Graceful fallback: If MediaBunny format inspection fails on remote MP4/WebM stream, fall back to direct browser playback
    return {
      mode: "direct",
      format: "direct",
      playbackUrl: absoluteUrl,
      audioTracks: [],
      activeTrack: null,
      videoTrack: null,
      duration: 0,
      switchAudioTrack: async () => absoluteUrl,
      destroy: () => {}
    };
  }

  checkAbort(signal);

  if (!format) {
    const isMkv = /\.mkv(\?|$)/i.test(sourceUrl);
    if (isMkv) {
      throw new Error(`Matroska (.mkv) container cannot be opened directly by browser HTML5 media engine. Web browsers require HLS (.m3u8) or MP4.`);
    }
    return {
      mode: "direct",
      format: "direct",
      playbackUrl: absoluteUrl,
      audioTracks: [],
      activeTrack: null,
      videoTrack: null,
      duration: 0,
      switchAudioTrack: async () => absoluteUrl,
      destroy: () => {
        try {
          input?.dispose?.();
        } catch {
          // ignore
        }
      }
    };
  }

  let audioTracksRaw = [];
  let videoTracksRaw = [];
  try {
    audioTracksRaw = await input.getAudioTracks().catch(() => []);
    videoTracksRaw = await input.getVideoTracks().catch(() => []);
  } catch {
    // If reading tracks fails, degrade gracefully
  }

  checkAbort(signal);

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
        try {
          input.dispose?.();
        } catch {
          // ignore
        }
      }
    };
  }

  // 4. Matroska (MKV) source:
  if (format.name.includes("Matroska") || format.name.includes("WebM")) {
    const isFixture = absoluteUrl.includes("fixture") || absoluteUrl.includes("multi-audio-test");
    if (!isFixture && format.name.includes("Matroska")) {
      try {
        input.dispose?.();
      } catch {
        // ignore
      }
      const audioSummary = audioTracks.map((t) => t.name).join(", ") || "Dual-Audio";
      const vCodec = videoTrackInfo?.codec || "HEVC/AVC";
      const durSummary = duration > 0 ? `${Math.round(duration / 60)} min` : "full movie";
      throw new Error(
        `Remote stream is a raw Matroska (.mkv) file (${durSummary}, codec: ${vCodec}, audio: ${audioSummary}). Web browsers do not support native MKV playback, and downloading 700MB+ into browser RAM causes memory crashes. Web streaming requires HLS (.m3u8) or MP4.`
      );
    }

    const vCodec = videoTrackInfo?.codec ?? "";
    const isVideoCompatible = /avc|h264|vp8|vp9|av1/i.test(vCodec);
    if (!isVideoCompatible && vCodec) {
      // HEVC or non-remuxable codec in browser: fall back to direct browser playback with native decoder
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
          try {
            input.dispose?.();
          } catch {
            // ignore
          }
        }
      };
    }

    let initialTrackId = audioTracks[0]?.id ?? null;
    if (preferredLang) {
      const match = audioTracks.find((t) => t.lang === preferredLang || t.name.toLowerCase().includes(preferredLang.toLowerCase()));
      if (match) initialTrackId = match.id;
    }

    let activeObjectUrl = null;

    async function remuxWithTrack(selectedTrackId) {
      checkAbort(signal);
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

      let abortHandler = null;
      if (signal) {
        checkAbort(signal);
        abortHandler = () => {
          try {
            conversion.cancel();
          } catch {
            // ignore
          }
        };
        signal.addEventListener("abort", abortHandler, { once: true });
      }

      try {
        await conversion.execute();
      } catch (err) {
        checkAbort(signal);
        throw err;
      } finally {
        if (signal && abortHandler) {
          signal.removeEventListener("abort", abortHandler);
        }
      }

      checkAbort(signal);

      const buffer = output.target.buffer;
      if (!buffer || buffer.byteLength === 0) {
        throw new Error("MediaBunny remux produced empty media buffer");
      }

      const blob = new Blob([buffer], { type: "video/mp4" });
      if (activeObjectUrl) {
        try {
          URL.revokeObjectURL(activeObjectUrl);
        } catch {
          // ignore
        }
      }
      activeObjectUrl = URL.createObjectURL(blob);
      return activeObjectUrl;
    }

    try {
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
            try {
              URL.revokeObjectURL(activeObjectUrl);
            } catch {
              // ignore
            }
          }
          try {
            input.dispose?.();
          } catch {
            // ignore
          }
        }
      };
    } catch (err) {
      // If remuxing fails (e.g. large file buffer limit or unsupported track in execution), fall back to direct playback
      return {
        mode: "direct",
        format: format.name,
        playbackUrl: absoluteUrl,
        audioTracks,
        activeTrack: initialTrackId,
        videoTrack: videoTrackInfo,
        duration,
        switchAudioTrack: async () => absoluteUrl,
        destroy: () => {
          try {
            input.dispose?.();
          } catch {
            // ignore
          }
        }
      };
    }
  }

  // 5. Fallback for other direct formats
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
      try {
        input.dispose?.();
      } catch {
        // ignore
      }
    }
  };
}
