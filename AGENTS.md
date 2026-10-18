# STREAMIX — Agent Rules (permanent)

STREAMIX is a responsive Netflix-style movie and series streaming website driven by real content from CloudStream/CSX provider implementations. Streams are resolved from real providers and played through a browser-side MediaBunny media pipeline with multi-audio switching, HLS support, and honest codec/CORS reporting.

## Non-negotiable rules

1. Never invent data. No fabricated movies, series, catalogs, search results, provider results, stream URLs, audio tracks, or playback claims. Every title, result, and stream shown must come from a real HTTP request to a real provider or real media source.
2. Never claim a test passed unless it was actually executed and the output observed. Record the exact command and observed result in `PROGRESS.md` before marking any task complete.
3. Never commit secrets, API keys, tokens, or real credentials. Keys live only in `.env` (gitignored). `.env.example` contains placeholder keys only.
4. The CSX manifest `https://raw.githubusercontent.com/SaurabhKaperwan/CSX/builds/CS.json` is a plugin repository manifest (a JSON list locating provider extensions). It is NOT a playable video URL and must never be treated as one.
5. CloudStream `.cs3` extensions generally contain Kotlin/Android code and do NOT execute in Node.js. To support a provider: read its actual extension source in the CSX repo, then implement/port its search, detail, and extractor logic to JavaScript, replicating the real endpoints, parameters, headers, and parsing. Do not fake a port without reading the source.
6. Small, verifiable tasks only. Do not generate the entire application in one operation. After every task, update `PROGRESS.md` (files changed, commands run with results, known issues, next task) before finishing.
7. Honest capability reporting. If a feature is unimplemented, degraded, or fails (e.g. CORS blockage, unsupported video/audio codec, or inaccessible source), say so explicitly. Expose only content, audio tracks, and subtitles that actually exist.
8. Code style: JavaScript ESM everywhere, keep dependencies minimal.

## Testing requirements

- After any dependency, config, or code change, run the affected verification and observe the output:
  - dependencies changed → `npm install`
  - client touched → `npm run build` and `npm run test:client`
  - end-to-end media pipeline touched → `node scripts/verify-client-mediabunny.mjs`
- Record evidence (exact command + observed result summary) in `PROGRESS.md`. A task is not complete until its verification ran and passed.
- Fix errors caused by the current task before moving on. Never mark a known-broken state as done.

## Protected architecture constraints

- Monorepo layout: `packages/client` (React + Vite, client-side UI and MediaBunny playback pipeline) and `packages/server` (Node + Express, preserved intact for standalone reference but unused at client runtime).
- Client runtime independence: The client runs standalone without making any runtime requests to `/api/*` or relying on backend FFmpeg/HLS transcoding sessions.
- Playback pipeline: MediaBunny (`mediabunny`) provides browser-side media inspection, container demuxing, real audio-track discovery, and remuxing of compatible MKV sources into MP4. Direct browser-playable media (MP4, WebM) and HLS streams play directly in the browser.
- Multi-audio is a core requirement: MediaBunny discovers real audio tracks from the media container (names, languages, codecs) and dynamically switches audio tracks upon user selection. Never show fake or fabricated audio tracks.
- No hardcoded movie/series catalogs anywhere in the codebase.
- Git: create a checkpoint commit per completed task, stage only intended files, never rewrite existing history, never commit `node_modules`, `dist`, `.env`, or secrets.
