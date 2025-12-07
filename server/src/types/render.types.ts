/**
 * Type definitions for video rendering
 */

export interface TimeRange {
  start: number;
  end: number;
}

export interface RenderResponse {
  jobId: string;
  outputFile: string;
  segments: TimeRange[];
  transcoded?: boolean | undefined;
  warning?: string | undefined;
}

export interface VideoMetadata {
  duration: number;
  width: number;
  height: number;
}

export interface TextOverlay {
  id: number;
  type: 'text';
  text: string;
  start: number;
  end: number;
  x: number;
  y: number;
  fontSize?: number | undefined;
  fontColor?: string | undefined;
  backgroundColor?: string | undefined;
  opacity?: number | undefined;
}

export interface ImageOverlay {
  id: number;
  type: 'image';
  imageUrl: string;
  start: number;
  end: number;
  x: number;
  y: number;
  width?: number | undefined;
  height?: number | undefined;
  opacity?: number | undefined;
}

export interface ShapeOverlay {
  id: number;
  type: 'shape';
  shapeType: 'rectangle';
  start: number;
  end: number;
  x: number;
  y: number;
  width?: number | undefined;
  height?: number | undefined;
  color?: string | undefined;
  strokeWidth?: number | undefined;
  fill?: boolean | undefined;
  opacity?: number | undefined;
}

export type Overlay = TextOverlay | ImageOverlay | ShapeOverlay;

export interface VideoSource {
  url: string;
  type: 'video' | 'image';
  duration?: number | undefined;
}

export interface RenderRequest {
  sources: VideoSource[];
  sourceUrl?: string | undefined;
  trimStart: number;
  trimEnd: number;
  cuts: TimeRange[];
  overlays: Overlay[];
  format: 'mp4';
}

