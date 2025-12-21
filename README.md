# Video Editor Component

A comprehensive Angular video editor component library with timeline editing, overlays, audio mixing, and server-side rendering capabilities.

## 📦 Library Package

This project contains both:
- **Library**: `@assifdaudi/video-editor-lib` - The reusable Angular component library
- **Demo App**: Example application demonstrating the library usage
- **Server**: Backend server for video processing (FFmpeg-based)

## 🚀 Quick Start

### Using the Library

Install the library in your Angular project:

```bash
npm install @assifdaudi/video-editor-lib
```

Then import and use the component:

```typescript
import { VideoEditorComponent } from '@assifdaudi/video-editor-lib';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [VideoEditorComponent],
  template: '<app-video-editor />'
})
export class App {}
```

See the [Library README](./projects/video-editor-lib/README.md) for complete documentation.

## 🛠️ Development

### Prerequisites

- Node.js 18+ 
- npm 9+
- FFmpeg (for server-side rendering)

### Setup

```bash
# Install dependencies
npm install

# Install server dependencies
cd server && npm install && cd ..
```

### Development Scripts

```bash
# Start development server (client only)
npm run dev:client

# Start development server (client + server)
npm run dev

# Build the library
npm run build:lib

# Build the library in watch mode
npm run build:lib:watch

# Lint all code
npm run lint:all

# Run tests
npm test
```

### Project Structure

```
video-editor-component3/
├── projects/
│   └── video-editor-lib/          # Library package
│       ├── src/
│       │   ├── lib/
│       │   │   └── video-editor/  # Main library code
│       │   └── public-api.ts      # Public API exports
│       ├── package.json            # Library package.json
│       └── ng-package.json         # Library build config
├── src/
│   └── app/                        # Demo application
│       └── app.ts                  # Uses the library
├── server/                          # Backend server
│   └── src/                        # Server source code
└── package.json                    # Root package.json
```

## 📚 Documentation

- [Library Documentation](./projects/video-editor-lib/README.md) - Complete library usage guide
- [Server Documentation](./server/README.md) - Backend server setup and API

## 🎯 Features

- ✅ Timeline editing (cut/keep segments)
- ✅ Multiple video/image sources
- ✅ Overlays (text, images, shapes)
- ✅ Audio mixing (multiple tracks)
- ✅ Server-side rendering (FFmpeg)
- ✅ Drag and drop file support
- ✅ URL input support
- ✅ Fully typed (TypeScript)

## 📝 License

MIT

## 🤝 Contributing

Contributions are welcome! Please ensure all tests pass and linting is clean before submitting PRs.
