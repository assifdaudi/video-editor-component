/**
 * Video Editor Module Barrel Export
 * 
 * This file provides a centralized export point for all video editor related files.
 */

// Component
export { VideoEditorComponent } from './video-editor.component';

// Configuration tokens
export { VIDEO_EDITOR_API_BASE_URL } from './tokens';

// Types
export type {
  VideoSource,
  TimelineCut,
  TimelineSegment,
  BaseOverlay,
  TextOverlay,
  ImageOverlay,
  ShapeOverlay,
  Overlay,
  RenderResponse,
  TimelineDrag,
  OverlayDragState,
  OverlayResizeState,
  VideoBounds,
  TimelineSelection,
  AudioSource,
  AudioTimelineDrag
} from './video-editor.types';

// Services (exported for advanced usage)
export { RenderService } from './services/render.service';
export { AudioService } from './services/audio.service';
export { TimelineService } from './services/timeline.service';
export { VideoPlayerService } from './services/video-player.service';
export { OverlayService } from './services/overlay.service';

// Utilities
export {
  formatTime,
  clamp,
  timeToPercent,
  isImageUrl,
  isMpdUrl,
  isValidDuration,
  percentToPixels,
  pixelsToPercent
} from './video-editor.utils';

// File upload utilities
export {
  createLocalFileUrl,
  revokeLocalFileUrl,
  isValidSourceFile,
  isValidAudioFile,
  isValidImageFile
} from './utils/file-upload.utils';

// Video metadata utilities
export {
  getVideoDuration,
  getAudioDuration
} from './utils/video-metadata.utils';

// Timeline utilities
export * from './utils/timeline.utils';

