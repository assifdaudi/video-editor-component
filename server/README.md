# Video Editor Backend Server

Node.js + Express backend for video rendering with FFmpeg.

## Features

- Multi-source video concatenation (MP4 + MPEG-DASH)
- Image-to-video conversion
- Trim and cut operations
- Text, image, and shape overlays
- Quality warnings for mixed format sources
- Automatic transcoding when needed

## Scripts

```bash
npm run dev        # Development server with hot reload
npm run build      # Build TypeScript to JavaScript
npm run start      # Start production server
npm run lint       # Run ESLint
npm run lint:fix   # Auto-fix ESLint issues
```

## Linting

The server has its own ESLint configuration optimized for Node.js:
- TypeScript strict rules
- Explicit return types required
- No Angular-specific rules
- Allows empty arrow functions (common in Express)
- Prefers interfaces over types

**Success Output:**
```
✓ All server files pass linting.
```

### From Root

```bash
npm run lint:server      # Lint server only
npm run lint:server:fix  # Auto-fix server issues
npm run lint:all         # Lint both client and server
```

## API Endpoints

### POST `/api/render`

Render a video with trims, cuts, and overlays.

**Request Body:**
```typescript
{
  sources: [
    { url: string, type: 'video' | 'image', duration?: number }
  ],
  trimStart: number,
  trimEnd: number,
  cuts: [{ start: number, end: number }],
  overlays: Overlay[],
  format: 'mp4'
}
```

**Response:**
```typescript
{
  jobId: string,
  outputFile: string,
  segments: { start: number, end: number }[],
  transcoded?: boolean,
  warning?: string
}
```

## Environment

- Node.js 14+
- FFmpeg installed (via @ffmpeg-installer/ffmpeg)
- Port: 4000 (default)

## Output

Rendered videos are saved to `server/output/` directory and served at `/output/<filename>`.

