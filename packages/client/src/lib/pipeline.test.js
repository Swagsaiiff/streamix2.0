import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  Input,
  Output,
  ALL_FORMATS,
  BufferSource,
  BufferTarget,
  Mp4OutputFormat,
  Conversion
} from "mediabunny";
import {
  isHlsUrl,
  isDirectBrowserPlayable
} from "../media/pipeline.js";
import {
  cleanVegaTitle,
  episodeFromUrl,
  pickCandidateForEpisode,
  hostLinkIndexForEpisode,
  selectMediaCandidates
} from "../providers/vegamovies.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.resolve(__dirname, "../../public/fixtures/multi-audio-test.mkv");

test("pipeline utility functions identify media types correctly", () => {
  assert.equal(isHlsUrl("https://example.com/stream/master.m3u8"), true);
  assert.equal(isHlsUrl("https://example.com/video.mp4"), false);
  assert.equal(isDirectBrowserPlayable("https://example.com/video.mp4?token=123"), true);
  assert.equal(isDirectBrowserPlayable("https://example.com/video.webm"), true);
  assert.equal(isDirectBrowserPlayable("https://example.com/movie.mkv"), false);
});

test("MediaBunny discovers real audio tracks in multi-audio MKV fixture", async () => {
  assert.ok(fs.existsSync(fixturePath), "Fixture must exist");
  const buf = fs.readFileSync(fixturePath);
  const input = new Input({
    source: new BufferSource(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)),
    formats: ALL_FORMATS
  });

  const format = await input.getFormat();
  assert.equal(format.name, "Matroska");

  const audioTracks = await input.getAudioTracks();
  assert.equal(audioTracks.length, 2, "Fixture must contain exactly 2 real audio tracks");

  const t1 = audioTracks[0];
  const t2 = audioTracks[1];

  assert.equal(await t1.getName(), "Audio Track 1 (English)");
  assert.equal(await t1.getLanguageCode(), "eng");
  assert.equal(await t1.getCodec(), "aac");

  assert.equal(await t2.getName(), "Audio Track 2 (Spanish)");
  assert.equal(await t2.getLanguageCode(), "spa");
  assert.equal(await t2.getCodec(), "aac");
});

test("MediaBunny remuxes multi-audio MKV to MP4 with selected audio track", async () => {
  const buf = fs.readFileSync(fixturePath);
  const input = new Input({
    source: new BufferSource(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)),
    formats: ALL_FORMATS
  });

  // Remux selecting audio track 3 (Spanish)
  const output = new Output({
    format: new Mp4OutputFormat(),
    target: new BufferTarget()
  });

  const conversion = await Conversion.init({
    input,
    output,
    audio: (track) => (track.id === 3 ? {} : { discard: true })
  });

  assert.equal(conversion.isValid, true);
  await conversion.execute();

  const outBuffer = output.target.buffer;
  assert.ok(outBuffer.byteLength > 1000, "Remuxed MP4 must contain valid media data");

  // Verify the resulting MP4 has the selected audio track
  const checkInput = new Input({
    source: new BufferSource(outBuffer),
    formats: ALL_FORMATS
  });
  const checkAudios = await checkInput.getAudioTracks();
  assert.equal(checkAudios.length, 1);
  assert.equal(await checkAudios[0].getCodec(), "aac");
});

test("VegaMovies title and episode helper functions parse correctly", () => {
  const cleaned = cleanVegaTitle("Download Inception (2010) Dual Audio [Hindi-English] 1080p BluRay");
  assert.equal(cleaned.title, "Inception");
  assert.equal(cleaned.year, 2010);

  const ep = episodeFromUrl("https://storage.example.com/Breaking.Bad.S02E05.1080p.mkv");
  assert.deepEqual(ep, { season: 2, episode: 5 });

  const picked = pickCandidateForEpisode(
    [
      "https://storage.example.com/show.s01e01.mkv",
      "https://storage.example.com/show.s01e02.mkv"
    ],
    { season: 1, episode: 2 }
  );
  assert.equal(picked.matched, true);
  assert.equal(picked.url, "https://storage.example.com/show.s01e02.mkv");

  assert.equal(hostLinkIndexForEpisode(1, 3), 2);
  assert.equal(selectMediaCandidates(["https://a.com/sample.mp4", "https://b.com/real.mkv"]).length, 1);
});
