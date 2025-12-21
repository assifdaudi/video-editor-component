# @assifdaudi/video-editor-lib

A comprehensive Angular video editor component library with timeline editing, overlays, audio mixing, and server-side rendering capabilities.

## Features

- 🎬 **Timeline Editing**: Cut/keep segments with visual timeline interface
- 🎨 **Overlays**: Add text, images, and shapes to videos
- 🎵 **Audio Mixing**: Multiple audio tracks with volume control and mixing modes
- 📹 **Multiple Sources**: Support for video and image sources
- 🎞️ **Server-Side Rendering**: FFmpeg-based video processing
- 📱 **Responsive**: Modern, responsive UI with drag-and-drop support
- 🔧 **TypeScript**: Fully typed with comprehensive type definitions

## Installation

```bash
npm install @assifdaudi/video-editor-lib
```

## Peer Dependencies

This library requires the following peer dependencies:

- `@angular/common` ^21.0.0
- `@angular/core` ^21.0.0
- `@angular/forms` ^21.0.0
- `rxjs` ~7.8.0

## Quick Start

### 1. Import the Component

```typescript
import { Component } from '@angular/core';
import { VideoEditorComponent } from '@assifdaudi/video-editor-lib';

@Component({
  selector: 'app-video-editor',
  standalone: true,
  imports: [VideoEditorComponent],
  template: '<app-video-editor />'
})
export class VideoEditorPage {}
```

**Or using a separate HTML template:**

```typescript
// video-editor.component.ts
import { Component } from '@angular/core';
import { VideoEditorComponent } from '@assifdaudi/video-editor-lib';

@Component({
  selector: 'app-video-editor',
  standalone: true,
  imports: [VideoEditorComponent],
  templateUrl: './video-editor.component.html'
})
export class VideoEditorPage {}
```

```html
<!-- video-editor.component.html -->
<app-video-editor></app-video-editor>
```

**Important Notes for HTML Usage:**

1. **Component Selector**: Use `<app-video-editor></app-video-editor>` (not self-closing `<app-video-editor />` in HTML templates)
   - Self-closing syntax works in inline templates but not in separate HTML files
   - Always use opening and closing tags: `<app-video-editor></app-video-editor>`

2. **Standalone Component**: The component is standalone, so you must import it in your component's `imports` array

3. **Full Example with HTML Template:**

```typescript
// my-video-editor.component.ts
import { Component } from '@angular/core';
import { VideoEditorComponent } from '@assifdaudi/video-editor-lib';

@Component({
  selector: 'app-my-video-editor',
  standalone: true,
  imports: [VideoEditorComponent],
  templateUrl: './my-video-editor.component.html',
  styleUrl: './my-video-editor.component.scss'
})
export class MyVideoEditorComponent {}
```

```html
<!-- my-video-editor.component.html -->
<div class="video-editor-container">
  <app-video-editor></app-video-editor>
</div>
```

```scss
/* my-video-editor.component.scss */
.video-editor-container {
  width: 100%;
  height: 100vh;
}
```

### 2. Import Library Styles (Required!)

**The component uses CSS variables for theming. You must import the library's styles file.**

**Option A: Import in your global styles.scss (Recommended)**

```scss
// styles.scss
@import '@assifdaudi/video-editor-lib/styles';
```

**Option B: Add to angular.json**

```json
{
  "projects": {
    "your-app": {
      "architect": {
        "build": {
          "options": {
            "styles": [
              "node_modules/@assifdaudi/video-editor-lib/styles.scss",
              "src/styles.scss"
            ]
          }
        }
      }
    }
  }
}
```

**Why this is needed:**
- Component styles are automatically embedded in the JavaScript bundle
- However, the styles use CSS variables (like `--card-glass`, `--text-primary`, etc.) for theming
- The library provides a `styles.scss` file that defines all required CSS variables
- Without importing this file, CSS variables will be undefined and the component will appear white/unstyled
- The variables control colors, backgrounds, borders, and other visual properties

**Customizing the theme:**
You can override the CSS variables after importing:

```scss
@import '@assifdaudi/video-editor-lib/styles';

:root {
  // Override default colors
  --accent: #your-color;
  --bg: #your-background;
  // ... etc
}
```

### 3. Configure API Base URL

The component requires a backend server for rendering. Configure the API base URL using Angular's dependency injection:

```typescript
import { provideHttpClient } from '@angular/common/http';
import { VIDEO_EDITOR_API_BASE_URL } from '@assifdaudi/video-editor-lib';

export const appConfig: ApplicationConfig = {
  providers: [
    provideHttpClient(),
    {
      provide: VIDEO_EDITOR_API_BASE_URL,
      useValue: 'http://localhost:3000/api' // Your backend API URL
    }
  ]
};
```

### 4. Set Up Backend Server

This library requires a backend server for video processing. The server should:

- Handle video rendering via FFmpeg
- Provide file upload endpoints
- Support the following endpoints:
  - `POST /api/render` - Render video with sources, cuts, overlays, and audio
  - `POST /api/upload` - Upload files (videos, images, audio)
  - `POST /api/cleanup` - Clean up uploaded files after rendering

See the server implementation in the `server/` directory of this repository for reference.

## Usage

### Basic Usage

**Option 1: Inline Template**

```typescript
import { Component } from '@angular/core';
import { VideoEditorComponent } from '@assifdaudi/video-editor-lib';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [VideoEditorComponent],
  template: '<app-video-editor />'
})
export class App {}
```

**Option 2: External HTML Template**

```typescript
// app.component.ts
import { Component } from '@angular/core';
import { VideoEditorComponent } from '@assifdaudi/video-editor-lib';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [VideoEditorComponent],
  templateUrl: './app.component.html'
})
export class App {}
```

```html
<!-- app.component.html -->
<app-video-editor></app-video-editor>
```

**⚠️ Important HTML Usage Note:**

- In **HTML template files**, always use opening and closing tags: `<app-video-editor></app-video-editor>`
- Self-closing syntax `<app-video-editor />` only works in inline TypeScript templates
- The component selector is `app-video-editor` (from the library's component definition)

```html
<!-- app.component.html -->
<app-video-editor />
```

**Important:** The component selector is `app-video-editor`, so always use `<app-video-editor />` (or `<app-video-editor></app-video-editor>`) in your HTML templates.

### Accessing Types

```typescript
import type {
  VideoSource,
  Overlay,
  AudioSource,
  RenderResponse
} from '@assifdaudi/video-editor-lib';
```

### Using Utilities

```typescript
import { formatTime, clamp } from '@assifdaudi/video-editor-lib';

const formatted = formatTime(125.5); // "2:05"
const clamped = clamp(150, 0, 100); // 100
```

## Component Features

### Timeline Editing

- **Cut Mode**: Remove unwanted segments
- **Keep Mode**: Keep only selected segments
- Visual timeline with drag-to-seek
- Trim start/end points

### Overlays

- **Text Overlays**: Customizable text with font size, color, and background
- **Image Overlays**: Position and resize images
- **Shape Overlays**: Rectangles and circles with customizable colors

### Audio Tracks

- Multiple audio tracks
- Volume control per track
- Master volume control
- Mix or replace original audio
- Timeline positioning and trimming

### Sources

- Multiple video/image sources
- Drag and drop file support
- URL input support
- Image duration configuration

## API Reference

### VideoEditorComponent

The main component. No inputs required - it's fully self-contained.

### Types

#### VideoSource

```typescript
interface VideoSource {
  id: number;
  url: string;
  type: 'video' | 'image';
  duration: number;
  order: number;
}
```

#### Overlay

```typescript
type Overlay = TextOverlay | ImageOverlay | ShapeOverlay;
```

#### AudioSource

```typescript
interface AudioSource {
  id: number;
  url: string;
  startTime: number;
  duration: number;
  volume: number;
  muted: boolean;
  audioTrimStart: number;
  audioTrimEnd: number;
}
```

### Services

The library exports several services that can be used directly if needed:

- `RenderService` - Handle video rendering requests
- `AudioService` - Manage audio tracks
- `TimelineService` - Manage cuts and segments
- `OverlayService` - Manage overlays
- `VideoPlayerService` - Video playback control

### Utilities

- `formatTime(seconds: number): string` - Format seconds as "M:SS" or "H:MM:SS"
- `clamp(value: number, min: number, max: number): number` - Clamp value between min and max
- `timeToPercent(time: number, duration: number): number` - Convert time to percentage
- `isImageUrl(url: string): boolean` - Check if URL is an image
- `isMpdUrl(url: string): boolean` - Check if URL is an MPD (DASH) file

## Styling

The component includes its own styles. To customize, you can:

1. Override CSS variables (if supported in future versions)
2. Use Angular's `::ng-deep` (not recommended)
3. Import and modify the SCSS files directly

## Browser Support

- Modern browsers with ES2022 support
- Requires support for:
  - HTML5 Video API
  - Drag and Drop API
  - File API
  - Fetch API

## Development

### Building the Library

```bash
npm run build:lib
```

### Watching for Changes

```bash
npm run build:lib:watch
```

### Linting

```bash
npm run lint:lib
```

## Server Requirements

The backend server must:

1. Have FFmpeg installed and available in PATH
2. Support the render API endpoints
3. Handle file uploads and cleanup
4. Support CORS for the frontend origin

See the `server/` directory in this repository for a complete reference implementation.

## License

MIT

## Contributing

Contributions are welcome! Please ensure all tests pass and linting is clean before submitting PRs.
