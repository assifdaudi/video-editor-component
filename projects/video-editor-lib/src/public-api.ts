/*
 * Public API Surface of video-editor-lib
 * 
 * This file exports all public APIs of the video editor library.
 * Use the barrel export from index.ts for cleaner imports.
 */

// Main component and all exports via barrel
export * from './lib/video-editor';

// Configuration tokens (explicit export for clarity)
export { VIDEO_EDITOR_API_BASE_URL } from './lib/video-editor/tokens';

// Styles entry point - users can import this if needed
// Note: Component styles are automatically embedded in the JS bundle,
// but this provides an explicit import path if required

