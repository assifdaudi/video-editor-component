import { Injectable, signal } from '@angular/core';
import type { Overlay, TextOverlay, ImageOverlay, ShapeOverlay, TimelineCut, TimelineSegment } from '../video-editor.types';
import { validateOverlayTimes, validateOverlayTimesForSegments } from '../utils/timeline.utils';
import { clamp } from '../video-editor.utils';

/**
 * Service for managing overlays (text, image, shape)
 */
@Injectable({
  providedIn: 'root'
})
export class OverlayService {
  // State
  protected readonly overlays = signal<Overlay[]>([]);
  protected readonly selectedOverlay = signal<Overlay | null>(null);
  
  private overlayCounter = 0;

  /**
   * Add a text overlay
   */
  addText(
    text: string,
    start: number,
    end: number,
    x: number,
    y: number,
    fontSize: number,
    fontColor: string,
    backgroundColor: string,
    opacity: number,
    duration: number,
    mode: 'cut' | 'keep',
    cuts: TimelineCut[],
    segments: TimelineSegment[]
  ): { success: boolean; error?: string } {
    if (!text.trim() || start >= end || end > duration) {
      return { success: false, error: 'Invalid overlay parameters.' };
    }

    const clampedStart = clamp(start, 0, duration);
    const clampedEnd = clamp(end, start + 0.1, duration);

    // Validate based on mode
    const validation = mode === 'keep' 
      ? validateOverlayTimesForSegments(clampedStart, clampedEnd, segments)
      : validateOverlayTimes(clampedStart, clampedEnd, cuts);
      
    if (!validation.isValid) {
      return { success: false, error: validation.error };
    }

    const overlay: TextOverlay = {
      id: ++this.overlayCounter,
      type: 'text',
      text: text.trim(),
      start: clampedStart,
      end: clampedEnd,
      x: clamp(x, 0, 100),
      y: clamp(y, 0, 100),
      fontSize,
      fontColor,
      backgroundColor,
      opacity: clamp(opacity, 0, 1)
    };

    this.overlays.set([...this.overlays(), overlay].sort((a, b) => a.start - b.start));
    return { success: true };
  }

  /**
   * Add an image overlay
   */
  addImage(
    imageUrl: string,
    start: number,
    end: number,
    x: number,
    y: number,
    widthPixels: number,
    heightPixels: number,
    opacity: number,
    duration: number,
    mode: 'cut' | 'keep',
    cuts: TimelineCut[],
    segments: TimelineSegment[]
  ): { success: boolean; error?: string } {
    if (!imageUrl.trim() || start >= end || end > duration) {
      return { success: false, error: 'Invalid overlay parameters.' };
    }

    const clampedStart = clamp(start, 0, duration);
    const clampedEnd = clamp(end, start + 0.1, duration);

    // Validate based on mode
    const validation = mode === 'keep' 
      ? validateOverlayTimesForSegments(clampedStart, clampedEnd, segments)
      : validateOverlayTimes(clampedStart, clampedEnd, cuts);
      
    if (!validation.isValid) {
      return { success: false, error: validation.error };
    }

    const overlay: ImageOverlay = {
      id: ++this.overlayCounter,
      type: 'image',
      imageUrl: imageUrl.trim(),
      start: clampedStart,
      end: clampedEnd,
      x: clamp(x, 0, 100),
      y: clamp(y, 0, 100),
      width: widthPixels,
      height: heightPixels,
      opacity: clamp(opacity, 0, 1)
    };

    this.overlays.set([...this.overlays(), overlay].sort((a, b) => a.start - b.start));
    return { success: true };
  }

  /**
   * Add a shape overlay
   */
  addShape(
    shapeType: 'rectangle',
    start: number,
    end: number,
    x: number,
    y: number,
    widthPixels: number,
    heightPixels: number,
    color: string,
    strokeWidth: number,
    fill: boolean,
    opacity: number,
    duration: number,
    mode: 'cut' | 'keep',
    cuts: TimelineCut[],
    segments: TimelineSegment[]
  ): { success: boolean; error?: string } {
    if (start >= end || end > duration) {
      return { success: false, error: 'Invalid overlay parameters.' };
    }

    const clampedStart = clamp(start, 0, duration);
    const clampedEnd = clamp(end, start + 0.1, duration);

    // Validate based on mode
    const validation = mode === 'keep' 
      ? validateOverlayTimesForSegments(clampedStart, clampedEnd, segments)
      : validateOverlayTimes(clampedStart, clampedEnd, cuts);
      
    if (!validation.isValid) {
      return { success: false, error: validation.error };
    }

    const overlay: ShapeOverlay = {
      id: ++this.overlayCounter,
      type: 'shape',
      shapeType,
      start: clampedStart,
      end: clampedEnd,
      x: clamp(x, 0, 100),
      y: clamp(y, 0, 100),
      width: widthPixels,
      height: heightPixels,
      color,
      strokeWidth: clamp(strokeWidth, 1, 20),
      fill,
      opacity: clamp(opacity, 0, 1)
    };

    this.overlays.set([...this.overlays(), overlay].sort((a, b) => a.start - b.start));
    return { success: true };
  }

  /**
   * Update an existing overlay
   */
  updateOverlay(updatedOverlay: Overlay): void {
    this.overlays.update(overlays =>
      overlays.map(o => o.id === updatedOverlay.id ? updatedOverlay : o)
    );
  }

  /**
   * Delete an overlay
   */
  deleteOverlay(id: number): void {
    this.overlays.update(overlays => overlays.filter(o => o.id !== id));
    
    const selected = this.selectedOverlay();
    if (selected && selected.id === id) {
      this.selectedOverlay.set(null);
    }
  }

  /**
   * Select an overlay
   */
  selectOverlay(overlay: Overlay | null): void {
    this.selectedOverlay.set(overlay);
  }

  /**
   * Get overlays signal
   */
  getOverlays(): typeof this.overlays {
    return this.overlays;
  }

  /**
   * Get selected overlay signal
   */
  getSelectedOverlay(): typeof this.selectedOverlay {
    return this.selectedOverlay;
  }

  /**
   * Clear all overlays
   */
  clearAll(): void {
    this.overlays.set([]);
    this.selectedOverlay.set(null);
  }
}

