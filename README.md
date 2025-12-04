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
# or
npm run dev:client

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

Or from the project root:

```bash
npm run dev:server
```

The server will log progress percentage during video rendering operations.

### Run both servers together

From the project root:

```bash
npm run dev
```

That command launches the backend on `http://localhost:4000` and Angular dev server on `http://localhost:4200` using `concurrently`. Stop both with `Ctrl+C`.

### Run in separate terminals

You can also run the frontend and server in separate terminals for better log visibility:

**Terminal 1 (Server):**
```bash
npm run dev:server
# or
cd server && npm run dev
```

**Terminal 2 (Frontend):**
```bash
npm run dev:client
# or
npm start
```

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

### MPD (MPEG-DASH) Transcoding

When processing MPD streams, the backend transcodes them to MP4 format. The quality settings depend on whether the MPD is used alone or with other sources.

**⚠️ Quality Warning:** Mixing MPD and MP4 sources in multi-source mode requires multiple encoding passes, which may reduce video quality. For best results, use sources of the same format (all MPD or all MP4). 

When mixing formats is detected:
- A confirmation dialog appears **when adding a source** that would mix formats
- The backend logs a warning during rendering
- The final response includes a quality warning message

You must explicitly confirm to proceed with mixed formats when adding the source.

**Quality Settings:**

```bash
# Multi-source MPD: Near-lossless quality (will be re-encoded during concatenation)
MPD_TRANSCODE_CRF_MULTI=10  # Default: 10 (near-lossless)

# Single-source MPD: Good quality (no re-encoding needed)
MPD_TRANSCODE_CRF_SINGLE=18 # Default: 18 (good quality)

# MPD transcode preset (applies to both)
MPD_TRANSCODE_PRESET=medium # Default: medium (balanced speed/quality)

# Regular encoding settings (used for final output and concatenation)
FFMPEG_CRF=20
FFMPEG_PRESET=veryfast
```

**Why Two Quality Levels?**

**Multi-Source (MP4 + MPD):**
1. **First pass**: MPD → MP4 at **CRF 10** (near-lossless, ~3-5x larger temp file)
2. **Second pass**: Concatenation at **CRF 18, medium preset**
3. **Third pass**: Final output (trim/cuts/overlays) at **CRF 18, medium preset**

Result: MPD quality matches MP4 sources throughout the entire pipeline.

**Single-Source (MPD only):**
1. **Only pass**: MPD → MP4 at **CRF 18** (good quality, reasonable size)

Result: Good quality without the overhead of near-lossless intermediate files.

**File Size Impact:**
- CRF 10 (near-lossless): ~3-5x larger than CRF 18
- These are temporary files (cleaned up after rendering)
- Final output always uses regular `FFMPEG_CRF` (20)

**Optional Restrictions:**

You can enable restrictions to limit resource usage:

```bash
# Enable or disable restrictions (default: false)
ENABLE_MPD_RESTRICTIONS=false

# Maximum video duration in seconds (default: 3600 = 1 hour)
MAX_VIDEO_DURATION_SECONDS=3600

# Maximum video resolution (default: 1920x1080)
MAX_VIDEO_WIDTH=1920
MAX_VIDEO_HEIGHT=1080

# Transcode timeout in milliseconds (default: 7200000 = 2 hours)
TRANSCODE_TIMEOUT_MS=7200000

# Maximum temp file size in MB (default: 5000 = 5GB)
MAX_TEMP_FILE_SIZE_MB=5000
```

**Example (enable restrictions):**

```bash
cd server
ENABLE_MPD_RESTRICTIONS=true \
MAX_VIDEO_DURATION_SECONDS=1800 \
MAX_VIDEO_WIDTH=1280 \
MAX_VIDEO_HEIGHT=720 \
npm run dev
```

When restrictions are enabled:
- MPD streams are validated before transcoding (duration and resolution)
- Transcoding operations have a timeout to prevent hanging processes
- Output file size is checked after transcoding
- Violations result in an error response with details

When disabled (default):
- No limits on video duration, resolution, or file size
- No timeout on transcoding operations
- Suitable for trusted environments or local development

## Notes

- Rendering happens asynchronously but within the request cycle—large assets will hold the HTTP connection until FFmpeg finishes. For production, move the job orchestration into a queue/worker.
- The frontend currently assumes the backend is reachable at `http://localhost:4000`; adjust `src/environments/environment.ts` if needed.
