# Video Editor Component

A modern Angular + TypeScript video editing interface with a Node.js/FFmpeg backend. Stage non-destructive trims and cuts visually on a unified timeline, then render the final output server-side without touching the original source file.



https://github.com/user-attachments/assets/31631395-fbda-4450-8800-3188a147caa5

## New UI:


https://github.com/user-attachments/assets/767198b8-f3a6-4228-8413-e74c6963384b



## Features

### Video Editing
- **Unified Timeline**: Click to scrub, drag to move playhead, Shift+drag to create cuts
- **Visual Editing**: See trim zones, cut segments, and playhead position in real-time
- **MP4 & MPEG-DASH Support**: Load any MP4 URL or DASH manifest (`.mpd`) via dash.js
- **Multi-Source Concatenation**: Combine multiple videos and images into a single timeline
- **Non-Destructive Editing**: Original files remain untouched; all edits are rendered to new output
- **Audio/Video Sync**: Accurate seeking and timestamp regeneration ensures perfect sync

### Multi-Source Timeline
- **Video + Image Support**: Mix video clips (MP4/MPD) and static images (PNG/JPG/WebP)
- **Image Duration Control**: Set custom duration for each image source (default: 5 seconds)
- **Source Reordering**: Drag sources up/down to change playback order
- **Source Preview**: Navigate between sources with arrow buttons or keyboard (← →)
- **Timeline Visualization**: Visual separators show where each source begins
- **Click-to-Jump**: Click timeline boundaries to jump directly to any source

### Overlays
- **Text Overlays**: Add text with custom font size, color, background, and opacity
  - Transparent background option for text-only display
  - Draggable positioning in preview
  - Resizable from bottom-right corner
  - Time-based visibility (start/end timestamps)
  
- **Image Overlays**: Add logos, graphics, or any image
  - PNG transparency support (alpha channel respected)
  - Drag to position, resize from any corner
  - Pixel-perfect sizing that matches preview to output
  - Time-based visibility
  
- **Shape Overlays**: Add rectangular visual elements
  - Rectangle: Filled or stroked (outline only)
  - Custom colors, stroke width, opacity
  - Draggable and resizable with pixel-perfect sizing
  - Time-based visibility

### User Interface
- **Modern Dark Theme**: Clean, professional design with minimal aesthetic
- **Real-Time Preview**: See overlays exactly as they'll appear in the output
- **Drag & Drop**: Reposition overlays by dragging directly on the video preview
- **Interactive Timeline**: Visual representation of cuts, trims, and overlay timing
- **Keyboard Navigation**: Use arrow keys to navigate between sources
- **Responsive Design**: Adapts to different screen sizes

### Backend Processing
- **Server-Side Rendering**: FFmpeg backend handles all video processing
- **Smart Concatenation**: Automatic format normalization when mixing sources
- **Quality Preservation**: Intelligent encoding settings based on source types
- **Progress Tracking**: Real-time progress updates during rendering
- **Temporary File Cleanup**: Automatic cleanup of intermediate files

## Prerequisites

- Node.js 20+ (CLI warns when using odd releases such as 25.x)
- npm 10/11 (ships with Node)
- FFmpeg binary is bundled through `@ffmpeg-installer/ffmpeg`; no system install required.

## Quick Start Guide

### 1. Add Sources
- Enter a video URL (MP4 or MPD) or image URL (PNG/JPG/WebP) in the source form
- Click **"Add to Timeline"**
- For images, specify duration (default: 5 seconds)
- Add multiple sources to create a concatenated timeline
- Use up/down arrows to reorder sources
- **⚠️ Warning**: Mixing MPD and MP4 sources will trigger a quality warning

### 2. Preview Sources
- Navigate between sources using **← →** arrow buttons or keyboard
- Images display as static previews
- Videos play normally with full controls
- Source indicator shows current position (e.g., "Source 2 / 5")

### 3. Trim & Cut
- **Set Trim Points**: Use "Mark in from playhead" or input fields
- **Create Cuts**: 
  - **Shift+Drag** on timeline to select range
  - Click "Add Cut" button
  - Or use timeline playhead and input fields
- Cuts are displayed visually on the timeline
- Click any cut to jump to it or remove it

### 4. Add Overlays
Choose from three overlay types:

**Text Overlays:**
- Enter text, set timing (start/end)
- Customize font size, color, background
- Check "Transparent background" for text-only display
- Drag to position, resize from bottom-right corner

**Image Overlays:**
- Enter image URL (PNG with transparency supported!)
- Set size percentage and timing
- Drag to position, resize from any corner
- Perfect for logos, watermarks, graphics

**Shape Overlays:**
- Rectangle shapes for highlighting or framing
- Set color, stroke width, fill/stroke style
- Drag to position, resize as needed
- Useful for highlighting, borders, or visual markers

### 5. Render
- Click **"Send to backend"** button
- Watch progress in real-time
- Preview rendered video directly in browser
- Download final output when ready

## Keyboard Shortcuts

- **← (Left Arrow)**: Navigate to previous source
- **→ (Right Arrow)**: Navigate to next source  
- **Shift + Drag** (on timeline): Create a new cut range
- **Click** (on timeline): Seek to timestamp
- **Drag** (on timeline playhead): Scrub through video

## Technical Details

### Frontend Stack
- **Angular 21**: Modern reactive framework with Signals
- **TypeScript 5.9**: Type-safe component development
- **Dash.js 5.1**: MPEG-DASH streaming support
- **Reactive Forms**: Form validation and input handling
- **Standalone Components**: Modern Angular architecture

### Backend Stack
- **Node.js 25**: JavaScript runtime
- **Express 5.1**: Web server framework
- **FFmpeg**: Video processing (bundled via `@ffmpeg-installer/ffmpeg`)
- **Zod**: TypeScript-first schema validation
- **TypeScript**: Type-safe server code

### Video Processing Pipeline
1. **Source Download**: Videos/images downloaded to temporary directory
2. **Image Conversion**: Images converted to video segments with silent audio
3. **Format Normalization**: Mixed formats transcoded for compatibility
4. **Concatenation**: Sources stitched into single timeline
5. **Cutting**: Unwanted segments removed (trim/cuts)
6. **Overlay Application**: Text/images/shapes composited using FFmpeg filters
7. **Final Encoding**: Output rendered with quality settings
8. **Cleanup**: Temporary files automatically removed

### FFmpeg Techniques
- **`drawtext`**: Text overlay rendering with custom fonts and backgrounds
- **`overlay`**: Image/shape compositing with alpha blending
- **`drawbox`**: Shape drawing (rectangles, arrows)
- **`scale`**: Pixel-perfect image sizing with aspect ratio preservation
- **`concat`**: Demuxer for seamless multi-source stitching
- **`loop`**: Image frame duplication for static display
- **Time-based filters**: `enable='between(t,start,end)'` for timed visibility
- **Smart encoding**: Stream copy vs transcode based on source requirements

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
  "sources": [
    { "url": "http://127.0.0.1:3001/video1.mp4", "type": "video" },
    { "url": "http://127.0.0.1:3001/image.png", "type": "image", "duration": 5 },
    { "url": "http://127.0.0.1:3001/video2.mp4", "type": "video" }
  ],
  "trimStart": 3.5,
  "trimEnd": 42.7,
  "cuts": [{ "start": 10.0, "end": 15.2 }],
  "overlays": [
    {
      "id": 1,
      "type": "text",
      "text": "Hello World",
      "start": 5.0,
      "end": 10.0,
      "x": 10,
      "y": 10,
      "fontSize": 48,
      "fontColor": "#FFFFFF",
      "backgroundColor": "transparent",
      "opacity": 1
    },
    {
      "id": 2,
      "type": "image",
      "imageUrl": "https://example.com/logo.png",
      "start": 0,
      "end": 30,
      "x": 80,
      "y": 5,
      "width": 192,
      "height": 108,
      "opacity": 0.8
    },
    {
      "id": 3,
      "type": "shape",
      "shapeType": "rectangle",
      "start": 15,
      "end": 25,
      "x": 50,
      "y": 50,
      "width": 384,
      "height": 216,
      "color": "#FF0000",
      "strokeWidth": 3,
      "fill": false,
      "opacity": 1
    }
  ],
  "format": "mp4"
}
```

**Sources Array**:
- Each source has a `url`, `type` (video/image), and optional `duration` (for images, in seconds)
- Sources are concatenated in order
- Images are converted to video with the specified duration

**Overlays Array**:
- `x`, `y`: Position as percentage (0-100) relative to video dimensions
- Text overlays: Font size, colors, optional background
- Image overlays: `width`, `height` in pixels, supports PNG transparency
- Shape overlays: `width`, `height` in pixels, rectangle only with customizable color, stroke, and fill

The server processes all sources, applies cuts and overlays, and outputs a new video file under `server/output/`. The HTTP response returns the `jobId`, keep segments, `outputFile` path, and optional warnings (e.g., when mixing MPD and MP4 formats).

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

## Known Limitations

- **Synchronous Rendering**: Large files hold HTTP connection until complete (consider async queue for production)
- **MPD + MP4 Quality Loss**: Mixing formats requires multiple encoding passes (warning shown)
- **No Undo/Redo**: Changes are immediate (refresh to reset)
- **Limited Shape Types**: Only rectangle shapes supported (circles/arrows not implemented due to FFmpeg limitations)
- **Text Resize**: Only bottom-right corner resize for text overlays
- **Client-Side Preview**: Overlay positioning uses browser video player dimensions

## Future Enhancements

- [ ] Async job queue with status polling
- [ ] More shape types (circle, triangle, line, ellipse, custom SVG paths)
- [ ] Video filters (blur, brightness, contrast, saturation)
- [ ] Audio track management (volume, fade in/out, mute)
- [ ] Transition effects between sources (crossfade, wipe)
- [ ] Undo/Redo functionality with history stack
- [ ] Template presets for common layouts
- [ ] Batch processing multiple videos
- [ ] Direct upload support (not just URLs)
- [ ] Cloud storage integration (S3, GCS, Azure Blob)
- [ ] Animated overlays (moving text, panning images)
- [ ] Video rotation and flip transformations

## UI Design

The interface features a modern, professional design:

- **Color Scheme**: Pure black backgrounds with red accents (#ef4444)
- **Typography**: Inter font family for clean readability
- **Layout**: Card-based design with subtle borders and shadows
- **Border Radius**: Consistent 6-8px for a minimal, rectangular aesthetic
- **Buttons**: Flat design with red primary actions
- **Overlays**: Visual resize handles and hover states for interactivity
- **Timeline**: Visual representation with color-coded segments
- **Responsive**: Adapts to different screen sizes with clamp() for spacing

## Notes

- Rendering happens asynchronously but within the request cycle—large assets will hold the HTTP connection until FFmpeg finishes. For production, move the job orchestration into a queue/worker.
- The frontend currently assumes the backend is reachable at `http://localhost:4000`; adjust `src/environments/environment.ts` if needed.
- PNG images with transparency are fully supported for overlays
- The preview player accounts for letterboxing/pillarboxing when positioning overlays
- All temporary files are cleaned up automatically after rendering
- Image overlay sizes are stored in pixels for accurate rendering (converted from percentage input)
