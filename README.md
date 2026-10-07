# Code2Video Web

A production-oriented web app that converts HTML/JavaScript animations into deterministic MP4 video.

The app follows the requested architecture: React 18 + Vite + TypeScript on the client; Node.js + Express + Playwright + ffmpeg on the server; an isolated sandboxed iframe for browser previews; WebCodecs + `mp4-muxer` for Canvas mode; and Playwright + ffmpeg for Full-page mode.

## Folder structure

```text
code2video-web/
├── client/
│   ├── public/_redirects
│   ├── src/
│   │   ├── lib/bridge.ts
│   │   ├── lib/detection.ts
│   │   ├── lib/settings.ts
│   │   ├── render/canvasRenderer.ts
│   │   ├── render/serverRenderer.ts
│   │   ├── App.tsx
│   │   ├── main.tsx
│   │   ├── samples.ts
│   │   ├── styles.css
│   │   └── types.ts
│   ├── index.html
│   ├── package.json
│   ├── tsconfig.json
│   ├── vercel.json
│   └── vite.config.ts
├── server/
│   ├── src/
│   │   ├── lib/config.ts
│   │   ├── lib/loopCheck.ts
│   │   ├── lib/pathSecurity.ts
│   │   ├── lib/png.ts
│   │   ├── lib/ranges.ts
│   │   ├── lib/rateLimit.ts
│   │   ├── lib/validation.ts
│   │   ├── render/ffmpegEncoder.ts
│   │   ├── render/playwrightRenderer.ts
│   │   ├── index.ts
│   │   ├── jobManager.ts
│   │   └── types.ts
│   ├── Dockerfile
│   ├── package.json
│   └── tsconfig.json
├── tests/
│   ├── e2e/smoke.spec.ts
│   └── core.test.ts
├── .env.example
├── .gitignore
├── .prettierrc.json
├── docker-compose.yml
├── eslint.config.mjs
├── package.json
├── playwright.config.ts
├── seccomp_profile.json
└── vitest.config.ts
```

## Features

- Paste code or upload `.html`.
- Two deterministic render modes.
- Sandboxed preview iframe with `allow-scripts` only and communication through `postMessage`.
- Play/pause and time scrubber.
- Captured `console.log`, `info`, `warn`, `error`, runtime errors, and unhandled promise rejections.
- Resolution presets through 4K plus custom dimensions.
- 24 / 30 / 60 FPS.
- 1–120 second duration.
- Low / Medium / High quality.
- Optional MP3/WAV/M4A audio, trimmed or padded to the requested duration.
- Canvas-mode H.264 WebCodecs export with encoder backpressure and cancellation.
- Server-mode Playwright Chromium rendering with virtual time for DOM/CSS/SVG animations.
- 2–4 configurable page workers, contiguous frame ranges, and valid-PNG resume support.
- ffmpeg H.264 MP4 encoding with `yuv420p`, CRF 18/16/14, medium preset, and fast-start MP4.
- Server-Sent Events with polling fallback.
- HTTP Range support on finished videos.
- Server-side rate limiting, upload limits, per-frame timeout, per-job timeout, configurable concurrency, memory limit in Docker, and TTL cleanup.
- 160×90 mean-absolute-difference loop check.
- PNG current-frame export.
- Unit tests plus a Mode B smoke test.

## Requirements

- Node.js 20.19+.
- A Chromium-capable environment for Full-page server rendering.
- ffmpeg is supplied by `ffmpeg-static` for the Node app. The package currently supplies a 6.1.1 ffmpeg binary and should be pinned, as this repository does.
- Chrome or Edge is recommended for Canvas mode because browser WebCodecs H.264/AAC support is implementation-dependent.

The server Dockerfile uses the official Playwright image pinned to `mcr.microsoft.com/playwright:v1.63.0-noble`. The checked-in seccomp profile targets Linux x86_64; use the maintained multi-architecture Playwright profile when adapting the container to ARM64. Playwright recommends a non-root browser user plus a seccomp profile when launching Chromium with sandboxing for untrusted code; this repository follows that pattern with `pwuser`, `chromiumSandbox: true`, and `seccomp_profile.json`.

## Install

```bash
npm install
```

Playwright's browser package will be installed with the workspace dependency. In a host environment that does not already have the matching browser, run:

```bash
npx playwright install chromium
```

## Run in development

```bash
cp .env.example .env
npm run dev
```

Open `http://localhost:5173`.

The Vite dev server proxies `/api` to `http://localhost:3001`.

## Production build

```bash
npm run build
npm start
```

For a separate static frontend deployment, build the client with:

```bash
npm run build:client
```

The resulting `client/dist` directory can be served by Vercel, Netlify, Nginx, or any static host. Set `VITE_API_BASE_URL` at frontend build time when the API is not on the same origin.

## Docker

```bash
docker compose build
docker compose up -d
```

The server listens on port `3001` by default.

The Compose service applies a 2 GB memory cap, process limit, `init: true`, and the supplied seccomp profile. For production, place a reverse proxy with TLS in front of the service and use a persistent or disposable volume according to your retention requirements.

## Deployment

### Frontend on Vercel

Deploy the `client` directory as the project root. The included `vercel.json` rewrites application routes to `index.html`. Set `VITE_API_BASE_URL` to the public backend origin, for example `https://api.example.com`.

### Frontend on Netlify

Deploy `client` as the base directory with build command `npm run build` and publish directory `dist`. The included `public/_redirects` preserves SPA routing. Set `VITE_API_BASE_URL` to the public backend origin.

### Backend on Railway, Fly.io, or a VPS

Use the included Dockerfile from the repository root as build context. Example:

```bash
docker build -f server/Dockerfile -t code2video-server .
docker run --rm -p 3001:3001 --env-file .env code2video-server
```

For a public deployment, use a TLS reverse proxy, restrictive CORS, a durable or isolated job volume, and platform-level CPU/RAM limits. Keep `CLIENT_ORIGIN` set to the exact frontend origin rather than `*`.

## Environment variables

| Variable | Default | Purpose |
|---|---:|---|
| `PORT` | `3001` | HTTP server port |
| `HOST` | `0.0.0.0` | Bind address |
| `CLIENT_ORIGIN` | `http://localhost:5173` | CORS allow-list origin |
| `MAX_UPLOAD_MB` | `5` | Upload cap |
| `MAX_DURATION_SECONDS` | `120` | Maximum duration |
| `MAX_WIDTH` | `3840` | Maximum width |
| `MAX_HEIGHT` | `2160` | Maximum height |
| `MAX_CONCURRENT_JOBS` | `2` | Active server jobs |
| `WORKER_COUNT` | `2` | Playwright pages per job |
| `JOB_TIMEOUT_MS` | `900000` | Per-job timeout |
| `FRAME_TIMEOUT_MS` | `15000` | Per-frame timeout |
| `JOB_TTL_MS` | `3600000` | Finished job retention |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Rate-limit window |
| `RATE_LIMIT_MAX` | `20` | Requests per rate-limit window/IP |
| `TMP_ROOT` | `./tmp/jobs` | Temporary job root |
| `VITE_API_BASE_URL` | empty | Client-side API origin for separate frontend deployment |

## API

### `POST /api/jobs`

Multipart form fields:

- `htmlText` or `htmlFile` (`.html`)
- `settings` JSON
- optional `audio` file

Returns:

```json
{ "jobId": "uuid" }
```

### `GET /api/jobs/:id`

Returns status including `queued|rendering|encoding|done|error|cancelled`, frame progress, ETA, loop-check result, and video readiness.

### `GET /api/jobs/:id/events`

Server-Sent Events progress stream. The client falls back to polling if SSE is unavailable.

### `GET /api/jobs/:id/video`

Streams the MP4 and supports HTTP Range requests. Add `?download=1` for attachment-style delivery.

### `DELETE /api/jobs/:id`

Requests cancellation and removes temporary files when the job stops.

### `POST /api/frame`

Extra convenience endpoint for current-frame PNG export. It accepts the same HTML and settings shape plus `time` in seconds.

## Mode A: Canvas / in-browser

Canvas mode is intended for animation code that has both:

```html
<canvas width="1280" height="720"></canvas>
<script>
  const canvas = document.querySelector('canvas');
  const ctx = canvas.getContext('2d');

  window.draw = (t) => {
    // t is seconds from the animation start.
  };
</script>
```

The preview uses:

```html
<iframe sandbox="allow-scripts"></iframe>
```

There is deliberately no `allow-same-origin`. The parent and iframe communicate only through `window.postMessage`.

For export, the app requests each exact time, copies the returned `ImageBitmap` into an `OffscreenCanvas`, then creates a `VideoFrame` with microsecond timestamps and durations. Frames are encoded one by one with `VideoEncoder`. Encoder queue depth is kept below 10 and the renderer yields to the browser event loop between frames.

The browser uses H.264 High-profile codec strings selected from output resolution, checks `VideoEncoder.isConfigSupported()` before encoding, requests hardware acceleration when available, and inserts a keyframe every two seconds. `MediaRecorder` and `captureStream()` are intentionally not used.

Canvas sizes that do not match the selected export size are letterboxed with black while preserving the original aspect ratio; the UI warns when the source dimensions differ.

### Integer cycles for seamless loops

Drive motion from normalized loop progress and use integer cycle counts. A robust four-second loop looks like this:

```js
window.draw = (t) => {
  const progress = (t / 4) % 1;
  const angle = progress * Math.PI * 2 * 2; // exactly 2 cycles per loop
  const x = 640 + Math.cos(angle) * 180;
  const y = 360 + Math.sin(angle) * 90;
  // draw at x / y ...
};
```

The important part is that `draw(0)` and `draw(duration)` evaluate to the same state. Avoid persistent counters such as `x += velocity` unless you reset the entire simulation from `t` on every call.

## Mode B: Full page / server

Mode B is for normal HTML/CSS/JavaScript pages, SVG, DOM animations, and pages without `window.draw(t)`.

The backend creates a fresh Chromium context with the requested viewport and `deviceScaleFactor: 1`. User code runs only in Chromium; it is never `eval()`'d or executed inside the Node process.

All page network requests are intercepted. Only the job's local `file:` resources and `data:` URLs are allowed. Remote requests are aborted.

When `window.draw` exists, each frame calls `draw(t)` and takes a PNG screenshot.

Without `draw(t)`, the renderer uses Chrome DevTools Protocol virtual time and advances the page by exactly one frame duration per frame. `Date.now()` and `performance.now()` are exposed through a deterministic virtual clock for page JavaScript.

Each worker receives a contiguous frame range. Existing PNGs are reused only when both the PNG signature and IEND chunk are valid. Corrupt or partial files are rendered again.

ffmpeg then encodes the complete PNG sequence with:

```text
-framerate FPS -i f_%05d.png -c:v libx264 -pix_fmt yuv420p -crf 18/16/14 -preset medium -movflags +faststart
```

Optional audio is encoded as AAC and padded or trimmed to the exact requested duration.

## Security model

User code is untrusted. The important isolation layers are:

1. Canvas preview uses a sandboxed iframe without same-origin access.
2. Server rendering runs user code inside Playwright Chromium only.
3. Chromium is launched with sandboxing enabled.
4. The Docker runtime runs Chromium under `pwuser` with a seccomp profile.
5. Page requests are blocked except for job-local files and data/blob URLs.
6. Upload size, duration, resolution, concurrency, per-frame time, per-job time, and request rate are capped.
7. Job IDs are random UUIDs and internal filesystem paths are never returned to clients.
8. Temporary jobs have a TTL and are cleaned up.

This is defense-in-depth, not a guarantee against every possible browser or container escape. Keep the server behind standard infrastructure controls and do not grant the container access to secrets or host mounts it does not need.

## Known limitations

- Canvas mode is canvas-only and depends on browser WebCodecs H.264/AAC support; Chrome/Edge are the recommended clients.
- `mp4-muxer` is retained because it was explicitly required by the project specification, but the package is now deprecated in favor of Mediabunny. Future maintenance should consider a migration.
- Canvas mode keeps the encoded output in memory before download. Very large 4K exports can therefore require substantial browser memory.
- Server jobs are intentionally time-bounded and resource-capped. Complex pages may need lower resolution, fewer workers, or a smaller duration.
- Remote web assets are blocked by design. Put required images, fonts, scripts, or styles inside the uploaded job or embed them as `data:` resources.
- CSS and Web Animations are deterministic under server virtual time only to the extent that the browser APIs used by the page follow the virtual clock. Real hardware, device sensors, and network-driven animation are out of scope.
- Audio decoding/encoding support varies by browser in Canvas mode.
- The in-memory JobManager is intentionally simple. For multi-instance production scaling, replace it with a durable queue/store and a shared object store.

## Tests and checks

Unit tests:

```bash
npm test
```

Formatting check:

```bash
npm run format:check
```

Lint:

```bash
npm run lint
```

End-to-end smoke test:

```bash
npm run test:e2e
```

The smoke test posts a 1-second 720p server-rendered animation, waits for completion, and verifies that a non-empty MP4 can be fetched.

## Implementation checklist

- [x] React 18 + Vite + TypeScript client.
- [x] Node.js + Express + Playwright + ffmpeg server.
- [x] Paste/upload input.
- [x] Two seamless-loop sample animations using `window.draw(t)`.
- [x] Sandboxed iframe preview and postMessage bridge.
- [x] Play/pause, scrubber, time label, console/error panel.
- [x] HD / Full HD / 2K / 4K / custom resolution.
- [x] 24 / 30 / 60 FPS.
- [x] 1–120 second duration.
- [x] Low / Medium / High quality.
- [x] Auto / Canvas / Full-page render mode.
- [x] Loop check.
- [x] Optional MP3/WAV/M4A audio.
- [x] Browser WebCodecs rendering with H.264 and MP4 muxing.
- [x] Encoder backpressure, event-loop yielding, and cancellation.
- [x] Server job API, SSE, polling fallback, Range streaming, cancellation.
- [x] Playwright virtual-time rendering and parallel contiguous worker ranges.
- [x] Valid-PNG resume support.
- [x] ffmpeg MP4 encoding with requested CRF/preset/pixel format/fast-start.
- [x] Server-side 160×90 loop check.
- [x] Auto-detection and authoring help card.
- [x] Mobile-first responsive dark UI.
- [x] Reduced-motion handling for UI animation.
- [x] Rate limit, upload cap, timeouts, 4K cap, concurrency cap, memory limit, sandbox, path sanitization, and network blocking.
- [x] Unit tests and an end-to-end Mode B smoke test.
- [x] ESLint + Prettier.
- [x] Dockerfile + docker-compose + seccomp profile.
- [x] Deployment notes for Vercel, Netlify, Railway/Fly.io/VPS.
