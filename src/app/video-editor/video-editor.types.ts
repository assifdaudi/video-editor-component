/**
 * Video Editor Types and Interfaces
 * 
 * This file contains all type definitions used by the VideoEditorComponent.
 */

/**
 * Represents a video or image source in the timeline
 */
export interface VideoSource {
  id: number;
  url: string;
  type: 'video' | 'image';
  duration: number; // Duration in seconds (5s for images)
  order: number;
  startTime: number; // Cumulative start time in concatenated timeline
}

/**
 * Represents a cut/removal segment in the timeline
 */
export interface TimelineCut {
  id: number;
  start: number; // Start time in seconds
  end: number; // End time in seconds
}

/**
 * Represents a segment to keep in the timeline (inverse of cut)
 */
export interface TimelineSegment {
  id: number;
  start: number; // Start time in seconds
  end: number; // End time in seconds
}

/**
 * Base interface for all overlay types
 */
export interface BaseOverlay {
  id: number;
  type: 'text' | 'image' | 'shape';
  start: number; // Start time in seconds
  end: number; // End time in seconds
  x: number; // X position (0-100 percentage)
  y: number; // Y position (0-100 percentage)
  opacity?: number; // Opacity (0-1)
}

/**
 * Text overlay configuration
 */
export interface TextOverlay extends BaseOverlay {
  type: 'text';
  text: string;
  fontSize?: number; // Font size in pixels
  fontColor?: string; // Hex color code
  backgroundColor?: string; // Hex color code or 'transparent'
}

/**
 * Image overlay configuration
 */
export interface ImageOverlay extends BaseOverlay {
  type: 'image';
  imageUrl: string;
  width?: number; // Width in pixels (relative to video dimensions)
  height?: number; // Height in pixels (relative to video dimensions)
}

/**
 * Shape overlay configuration
 */
export interface ShapeOverlay extends BaseOverlay {
  type: 'shape';
  shapeType: 'rectangle';
  width?: number; // Width in pixels (relative to video dimensions)
  height?: number; // Height in pixels (relative to video dimensions)
  color?: string; // Hex color code
  strokeWidth?: number; // Stroke width in pixels
  fill?: boolean; // Whether to fill the shape
}

/**
 * Union type of all overlay types
 */
export type Overlay = TextOverlay | ImageOverlay | ShapeOverlay;

/**
 * Response from the backend render API
 */
export interface RenderResponse {
  jobId: string;
  outputFile: string;
  segments: { start: number; end: number }[];
  warning?: string;
}

/**
 * Timeline drag state
 */
export type TimelineDrag =
  | { pointerId: number; anchor: number; mode: 'selection' }
  | { pointerId: number; anchor: number; mode: 'playhead' }
  | null;

/**
 * Overlay drag state
 */
export interface OverlayDragState {
  overlay: Overlay;
  startX: number;
  startY: number;
  offsetX: number;
  offsetY: number;
}

/**
 * Overlay resize state
 */
export interface OverlayResizeState {
  overlay: Overlay;
  startWidth: number;
  startHeight: number;
  startX: number;
  startY: number;
  corner: 'se' | 'sw' | 'ne' | 'nw';
}

/**
 * Video bounds within container (for letterboxing/pillarboxing calculations)
 */
export interface VideoBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Timeline selection range
 */
export interface TimelineSelection {
  start: number;
  end: number;
}

/**
 * Represents an audio source in the timeline
 */
export interface AudioSource {
  id: number;
  url: string;
  startTime: number; // Start time in seconds on the timeline (adjusted for cuts)
  duration: number; // Duration in seconds (may be shortened if extends beyond video)
  originalDuration: number; // Original duration of the audio file before trimming
  originalStartTime?: number; // Original start time in the timeline before any cuts (for recalculation)
  audioTrimStart: number; // Start trim point within the audio file (0 = beginning)
  audioTrimEnd: number; // End trim point within the audio file (originalDuration = end)
  volume: number; // Volume level (0-1)
  muted: boolean; // Whether this track is muted
  solo: boolean; // Whether this track is solo (only this track plays)
  order: number; // Display order
}

/**
 * Audio timeline drag state
 */
export interface AudioTimelineDrag {
  audioId: number;
  startX: number;
  startTime: number;
}

