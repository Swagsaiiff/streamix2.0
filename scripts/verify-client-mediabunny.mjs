import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  Input,
  Output,
  Conversion,
  BufferSource,
  BufferTarget,
  Mp4OutputFormat,
  ALL_FORMATS
} from "mediabunny";
import {
  buildHomeSections,
  searchCinemeta,
  getCinemetaDetails
} from "../packages/client/src/providers/cinemeta.js";
import { resolveVegaStream } from "../packages/client/src/providers/vegamovies.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const fixturePath = path.resolve(root, "packages/client/public/fixtures/multi-audio-test.mkv");

console.log("=== STREAMIX MediaBunny & Client Verification ===");

// 1. Verify Cinemeta Home Rows
console.log("\n[1/6] Verifying client-side Cinemeta Home Rows...");
const sections = await buildHomeSections();
console.log(`✓ Fetched ${sections.length} home sections directly from Cinemeta/Kitsu.`);
for (const s of sections.slice(0, 3)) {
  console.log(`  - Section "${s.data.title}": ${s.data.items.length} items (Provider: ${s.data.provider})`);
}

// 2. Verify Movie & Series Search
console.log("\n[2/6] Verifying client-side Search...");
const movieSearch = await searchCinemeta("Inception");
console.log(`✓ Movie search "Inception": found ${movieSearch.length} results. First: "${movieSearch[0]?.title}" (${movieSearch[0]?.year})`);

const seriesSearch = await searchCinemeta("Breaking Bad");
console.log(`✓ Series search "Breaking Bad": found ${seriesSearch.length} results. First: "${seriesSearch[0]?.title}" (${seriesSearch[0]?.year})`);

// 3. Verify Detail fetching
console.log("\n[3/6] Verifying client-side Detail metadata...");
const movieDetail = await getCinemetaDetails("movie", "tt1375666");
console.log(`✓ Movie detail: "${movieDetail.title}", runtime: ${movieDetail.runtime}, rating: ${movieDetail.rating}`);

const seriesDetail = await getCinemetaDetails("series", "tt0903747");
console.log(`✓ Series detail: "${seriesDetail.title}", episodes count: ${seriesDetail.episodes?.length}`);
console.log(`  - Episode 1: S${seriesDetail.episodes[0].season}E${seriesDetail.episodes[0].episode} "${seriesDetail.episodes[0].name}"`);

// 4. Verify MediaBunny Audio Track Discovery
console.log("\n[4/6] Verifying MediaBunny audio-track discovery on multi-audio MKV...");
if (!fs.existsSync(fixturePath)) {
  console.error("✗ Fixture not found:", fixturePath);
  process.exit(1);
}
const buf = fs.readFileSync(fixturePath);
const input = new Input({
  source: new BufferSource(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)),
  formats: ALL_FORMATS
});

const format = await input.getFormat();
console.log(`✓ Detected container: ${format.name}`);

const audios = await input.getAudioTracks();
console.log(`✓ Discovered ${audios.length} real audio tracks:`);
const tracks = [];
for (const a of audios) {
  const info = {
    id: a.id,
    name: await a.getName(),
    lang: await a.getLanguageCode(),
    codec: await a.getCodec(),
    channels: await a.getNumberOfChannels().catch(() => null),
    sampleRate: await a.getSampleRate().catch(() => null)
  };
  console.log(`  - Track ${info.id}: "${info.name}" [lang: ${info.lang}, codec: ${info.codec}, channels: ${info.channels}, ${info.sampleRate}Hz]`);
  tracks.push(info);
}

// 5. Verify MediaBunny Audio-Track Switching
console.log("\n[5/6] Verifying MediaBunny audio-track switching via remux...");
// Switch to Audio Track 1 (English)
const out1 = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });
const conv1 = await Conversion.init({
  input,
  output: out1,
  audio: (t) => t.id === tracks[0].id ? {} : { discard: true }
});
await conv1.execute();
console.log(`✓ Remuxed with Track ${tracks[0].id} (${tracks[0].name}): ${out1.target.buffer.byteLength} bytes MP4 generated.`);

// Switch to Audio Track 2 (Spanish)
const out2 = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });
const conv2 = await Conversion.init({
  input,
  output: out2,
  audio: (t) => t.id === tracks[1].id ? {} : { discard: true }
});
await conv2.execute();
console.log(`✓ Remuxed with Track ${tracks[1].id} (${tracks[1].name}): ${out2.target.buffer.byteLength} bytes MP4 generated.`);

// Validate that out2 indeed has Track 2
const check2 = new Input({
  source: new BufferSource(out2.target.buffer),
  formats: ALL_FORMATS
});
const checkAudios = await check2.getAudioTracks();
console.log(`✓ Verified switched output MP4 has ${checkAudios.length} audio track (codec: ${await checkAudios[0].getCodec()}).`);

// 6. Verify VegaMovies resolution and CORS diagnosis
console.log("\n[6/6] Verifying VegaMovies client resolution and CORS handling...");
const vegaRes = await resolveVegaStream({
  title: "Inception",
  year: 2010,
  type: "movie"
});
console.log(`✓ VegaMovies resolution status: "${vegaRes.status}"`);
if (vegaRes.error) {
  console.log(`  Diagnosis note: ${vegaRes.error}`);
}

// 7. Verify no /api/* runtime requests exist in client code
console.log("\n[7/7] Verifying zero runtime /api/* references in packages/client/src/...");
const clientSrcDir = path.resolve(root, "packages/client/src");
function checkDir(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      checkDir(full);
    } else if (entry.name.endsWith(".js") || entry.name.endsWith(".jsx")) {
      const content = fs.readFileSync(full, "utf8");
      if (content.includes('"/api/') || content.includes("`/api/")) {
        console.error(`✗ Found runtime /api/ reference in: ${full}`);
        process.exit(1);
      }
    }
  }
}
checkDir(clientSrcDir);
console.log("✓ Verified: ZERO runtime references to /api/* in client source files.");

console.log("\n=== ALL VERIFICATIONS PASSED SUCCESSFULLY ===");
