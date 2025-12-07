/**
 * Video Editor Module Barrel Export
 * 
 * This file provides a centralized export point for all video editor related files.
 */

// Component
export { VideoEditorComponent } from './video-editor.component';

// Types
export type {
  VideoSource,
  TimelineCut,
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
  TimelineSelection
} from './video-editor.types';

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

