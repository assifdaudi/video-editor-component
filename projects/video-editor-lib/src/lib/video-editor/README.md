# Video Editor Component

A comprehensive video editing component built with Angular that supports multi-source concatenation, trimming, cutting, and overlay features.

## File Structure

```
video-editor/
├── index.ts                        # Barrel export for clean imports
├── video-editor.component.ts       # Main component logic
├── video-editor.component.html     # Template
├── video-editor.component.scss     # Styles
├── video-editor.types.ts           # Type definitions and interfaces
├── video-editor.utils.ts           # Utility functions
└── README.md                       # This file
```

## Files Overview

### `video-editor.component.ts`
The main component that handles:
- Video/image source management and concatenation
- Timeline controls (trim, cuts, overlays)
- Player state management
- Backend rendering integration
- Dash.js integration for MPD streams

### `video-editor.types.ts`
Type definitions including:
- `VideoSource` - Video or image source configuration
- `TimelineCut` - Cut segment definition
- `BaseOverlay`, `TextOverlay`, `ImageOverlay`, `ShapeOverlay` - Overlay types
- `RenderResponse` - Backend API response
- `VideoBounds` - Video bounds calculation
- Helper types for drag/resize states

### `video-editor.utils.ts`
Utility functions:
- `formatTime()` - Format seconds to HH:MM:SS or MM:SS
- `clamp()` - Clamp values between min/max
- `timeToPercent()` - Convert time to percentage
- `isImageUrl()` - Check if URL is an image
- `isMpdUrl()` - Check if URL is MPD manifest
- `isValidDuration()` - Validate duration values
- `percentToPixels()` / `pixelsToPercent()` - Convert between units

### `index.ts`
Barrel export file for clean imports:
```typescript
// Import component
import { VideoEditorComponent } from './video-editor';

// Import types
import type { VideoSource, Overlay } from './video-editor';

// Import utilities
import { formatTime, clamp } from './video-editor';
```

## Usage

### Basic Import
```typescript
import { VideoEditorComponent } from '@app/video-editor';
```

### Using Types
```typescript
import type { VideoSource, TextOverlay } from '@app/video-editor';

const source: VideoSource = {
  id: 1,
  url: 'https://example.com/video.mp4',
  type: 'video',
  duration: 120,
  order: 0,
  startTime: 0
};
```

### Using Utilities
```typescript
import { formatTime, clamp } from '@app/video-editor';

const timeString = formatTime(125.5); // "2:05"
const clamped = clamp(15, 0, 10); // 10
```

## Features

### Multi-Source Timeline
- Add multiple video and image sources
- Automatic concatenation and timing calculation
- Reorder sources with drag or arrows
- Preview source boundaries on timeline
- Navigate between sources with keyboard (← →)

### Trimming & Cutting
- Trim start and end points
- Add multiple cut segments
- Visual timeline with cuts displayed
- Drag to create cuts (hold Shift)
- Prevent overlapping cuts

### Overlays
- **Text Overlays**: Customizable text with font, color, background
- **Image Overlays**: Add watermarks or logos
- **Shape Overlays**: Rectangles with fill or stroke
- Drag to reposition overlays
- Resize handles for precise control
- Timeline preview of overlay timing

### Video Support
- Standard MP4 videos
- MPEG-DASH (MPD) streams via Dash.js
- Image sources (JPEG, PNG, GIF, WebP)
- Automatic format detection
- Quality warnings for mixed formats

### Backend Integration
- Send trim/cut/overlay configuration to backend
- FFmpeg-based server-side rendering
- Preview rendered output
- Download rendered video

## Code Organization

The component follows Angular best practices:
- ✅ Proper member ordering (public → protected → private)
- ✅ Explicit return types on all functions
- ✅ Type-safe interfaces with inheritance
- ✅ Extracted utility functions
- ✅ ESLint + angular-eslint configured
- ✅ Modern control flow syntax (@if, @for)

## Development

### Lint
```bash
npm run lint
```

### Build
```bash
npm run build
```

### Dev Server
```bash
npm run dev:client  # Frontend on :4200
npm run dev:server  # Backend API
npm run dev         # Both simultaneously
```

