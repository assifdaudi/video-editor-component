# Video Editor Component

A modern Angular + TypeScript video editing interface with a Node.js/FFmpeg backend. Stage non-destructive trims and cuts visually on a unified timeline, then render the final output server-side without touching the original source file.


https://github.com/user-attachments/assets/901d4e4c-032b-4acb-969e-9743783d165b





## Features

- **Unified Timeline**: Click to scrub, drag to move playhead, Shift+drag to create cuts
- **Visual Editing**: See trim zones, cut segments, and playhead position in real-time
- **MP4 & MPEG-DASH Support**: Load any MP4 URL or DASH manifest (`.mpd`) via dash.js
- **Server-Side Rendering**: FFmpeg backend handles all video processing
- **Audio/Video Sync**: Accurate seeking and timestamp regeneration ensures perfect sync

## Prerequisites

- Node.js 20+ (CLI warns when using odd releases such as 25.x)
- npm 10/11 (ships with Node)
- FFmpeg binary is bundled through `@ffmpeg-installer/ffmpeg`; no system install required.

## Frontend (Angular)

```bash
# install deps
npm install

# run frontend only
npm start        # -> http://localhost:4200

# production build
npm run build
```

Paste an MP4/MPD URL, set trim/cut ranges, then click **Send to backend** to hand the plan off to the server.

## Backend (FFmpeg worker)

```bash
cd server
npm install        # already run once, repeat after pulling changes
npm run dev        # starts on http://localhost:4000
# or
npm run build && npm start
```

### Run both servers together

From the project root:

```bash
npm run dev
```

That command launches the backend on `http://localhost:4000` and Angular dev server on `http://localhost:4200` using `concurrently`. Stop both with `Ctrl+C`.

Endpoints:

- `GET /health` – quick readiness probe.
- `POST /api/render` – body:

```json
{
  "sourceUrl": "http://127.0.0.1:3001/videoplayback.mp4",
  "trimStart": 3.5,
  "trimEnd": 42.7,
  "cuts": [{ "start": 10.0, "end": 15.2 }],
  "format": "mp4"
}
```

The server downloads/streams from `sourceUrl`, cuts each keep segment into temporary files, concatenates them, and emits a new asset under `server/output/`. The HTTP response returns the `jobId`, keep segments, and a `outputFile` path that the Angular UI links to for download.

Set `PORT`, `OUTPUT_DIR`, or `CORS_ORIGIN` env vars before starting the server to customize deployment.

## Notes

- Rendering happens asynchronously but within the request cycle—large assets will hold the HTTP connection until FFmpeg finishes. For production, move the job orchestration into a queue/worker.
- The frontend currently assumes the backend is reachable at `http://localhost:4000`; adjust `src/environments/environment.ts` if needed.
