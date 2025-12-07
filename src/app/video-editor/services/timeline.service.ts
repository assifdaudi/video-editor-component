import { Injectable, signal, computed } from '@angular/core';
import type { TimelineCut, TimelineSegment } from '../video-editor.types';
import { segmentsToCuts } from '../utils/timeline.utils';

/**
 * Service for managing timeline state (cuts, trim points, segments)
 */
@Injectable({
  providedIn: 'root'
})
export class TimelineService {
  // Mode: 'cut' = remove marked parts, 'keep' = keep only marked parts
  protected readonly mode = signal<'cut' | 'keep'>('cut');
  
  // State
  protected readonly trimStart = signal(0);
  protected readonly trimEnd = signal(0);
  protected readonly cuts = signal<TimelineCut[]>([]);
  protected readonly segments = signal<TimelineSegment[]>([]);
  protected readonly cutSelection = signal({ start: 0, end: 0 });
  protected readonly segmentSelection = signal({ start: 0, end: 0 });
  protected readonly timelineSelection = signal<{ start: number; end: number } | null>(null);

  // Computed
  protected readonly trimmedLength = computed(
    () => Math.max(this.trimEnd() - this.trimStart(), 0)
  );
  
  protected readonly hasCuts = computed(() => this.cuts().length > 0);
  protected readonly hasSegments = computed(() => this.segments().length > 0);
  
  // Computed signals that always return new array references for proper change detection
  protected readonly cutsForDisplay = computed(() => {
    const cuts = this.cuts();
    return cuts.length > 0 ? [...cuts] : [];
  });
  
  protected readonly segmentsForDisplay = computed(() => {
    const segments = this.segments();
    return segments.length > 0 ? [...segments] : [];
  });
  
  // Get effective cuts for rendering (converts segments if in keep mode)
  protected readonly effectiveCuts = computed(() => {
    if (this.mode() === 'keep') {
      return segmentsToCuts(this.segments(), this.trimStart(), this.trimEnd());
    }
    return this.cuts();
  });

  private cutCounter = 0;
  private segmentCounter = 0;
  private readonly minGap = 0.1;

  /**
   * Set trim start time
   */
  setTrimStart(time: number, maxDuration: number): void {
    const clamped = Math.max(0, Math.min(time, maxDuration));
    this.trimStart.set(clamped);
    
    // Ensure trimEnd is after trimStart
    if (this.trimEnd() <= clamped) {
      this.trimEnd.set(Math.min(clamped + this.minGap, maxDuration));
    }
  }

  /**
   * Set trim end time
   */
  setTrimEnd(time: number, maxDuration: number): void {
    const clamped = Math.max(0, Math.min(time, maxDuration));
    this.trimEnd.set(clamped);
    
    // Ensure trimStart is before trimEnd
    if (this.trimStart() >= clamped) {
      this.trimStart.set(Math.max(0, clamped - this.minGap));
    }
  }

  /**
   * Add a cut segment
   */
  addCut(start: number, end: number): { success: boolean; error?: string } {
    const trimStart = this.trimStart();
    const trimEnd = this.trimEnd();

    if (start >= end) {
      return { success: false, error: 'Cut start must be before end.' };
    }

    if (start < trimStart || end > trimEnd) {
      return { success: false, error: 'Cut must be within trim range.' };
    }

    // Check for overlaps with existing cuts
    const overlaps = this.cuts().some(
      c => (start >= c.start && start < c.end) || (end > c.start && end <= c.end) || (start <= c.start && end >= c.end)
    );

    if (overlaps) {
      return { success: false, error: 'Cut overlaps with existing cut.' };
    }

    const newCut: TimelineCut = {
      id: ++this.cutCounter,
      start,
      end
    };

    this.cuts.set([...this.cuts(), newCut].sort((a, b) => a.start - b.start));
    return { success: true };
  }

  /**
   * Delete a cut
   */
  deleteCut(id: number): void {
    const current = this.cuts();
    // Always create a new array reference to ensure Angular change detection
    const filtered = current.filter(c => c.id !== id);
    this.cuts.set([...filtered]);
  }

  /**
   * Clear all cuts
   */
  clearAllCuts(): void {
    this.cuts.set([]);
  }

  /**
   * Set the editing mode (cut or keep)
   */
  setMode(mode: 'cut' | 'keep'): void {
    this.mode.set(mode);
    // Clear selections when switching modes
    if (mode === 'cut') {
      this.segments.set([]);
    } else {
      this.cuts.set([]);
    }
  }

  /**
   * Add a segment to keep
   */
  addSegment(start: number, end: number): { success: boolean; error?: string } {
    const trimStart = this.trimStart();
    const trimEnd = this.trimEnd();

    if (start >= end) {
      return { success: false, error: 'Segment start must be before end.' };
    }

    if (start < trimStart || end > trimEnd) {
      return { success: false, error: 'Segment must be within trim range.' };
    }

    // Check for overlaps with existing segments
    const overlaps = this.segments().some(
      s => (start >= s.start && start < s.end) || (end > s.start && end <= s.end) || (start <= s.start && end >= s.end)
    );

    if (overlaps) {
      return { success: false, error: 'Segment overlaps with existing segment.' };
    }

    const newSegment: TimelineSegment = {
      id: ++this.segmentCounter,
      start,
      end
    };

    this.segments.set([...this.segments(), newSegment].sort((a, b) => a.start - b.start));
    return { success: true };
  }

  /**
   * Delete a segment
   */
  deleteSegment(id: number): void {
    const current = this.segments();
    // Always create a new array reference to ensure Angular change detection
    const filtered = current.filter(s => s.id !== id);
    this.segments.set([...filtered]);
  }

  /**
   * Clear all segments
   */
  clearAllSegments(): void {
    this.segments.set([]);
  }

  /**
   * Set segment selection (for adding new segments)
   */
  setSegmentSelection(start: number, end: number): void {
    this.segmentSelection.set({ start, end });
  }

  /**
   * Set cut selection (for adding new cuts)
   */
  setCutSelection(start: number, end: number): void {
    this.cutSelection.set({ start, end });
  }

  /**
   * Set timeline selection
   */
  setTimelineSelection(selection: { start: number; end: number } | null): void {
    this.timelineSelection.set(selection);
  }

  /**
   * Get trim start signal
   */
  getTrimStart(): typeof this.trimStart {
    return this.trimStart;
  }

  /**
   * Get trim end signal
   */
  getTrimEnd(): typeof this.trimEnd {
    return this.trimEnd;
  }

  /**
   * Get cuts signal
   */
  getCuts(): typeof this.cuts {
    return this.cuts;
  }

  /**
   * Get cut selection signal
   */
  getCutSelection(): typeof this.cutSelection {
    return this.cutSelection;
  }

  /**
   * Get timeline selection signal
   */
  getTimelineSelection(): typeof this.timelineSelection {
    return this.timelineSelection;
  }

  /**
   * Get trimmed length computed
   */
  getTrimmedLength(): typeof this.trimmedLength {
    return this.trimmedLength;
  }

  /**
   * Get hasCuts computed
   */
  getHasCuts(): typeof this.hasCuts {
    return this.hasCuts;
  }

  /**
   * Get mode signal
   */
  getMode(): typeof this.mode {
    return this.mode;
  }

  /**
   * Get segments signal
   */
  getSegments(): typeof this.segments {
    return this.segments;
  }

  /**
   * Get cuts for display (computed with new array reference)
   */
  getCutsForDisplay(): typeof this.cutsForDisplay {
    return this.cutsForDisplay;
  }

  /**
   * Get segments for display (computed with new array reference)
   */
  getSegmentsForDisplay(): typeof this.segmentsForDisplay {
    return this.segmentsForDisplay;
  }

  /**
   * Get segment selection signal
   */
  getSegmentSelection(): typeof this.segmentSelection {
    return this.segmentSelection;
  }

  /**
   * Get hasSegments computed
   */
  getHasSegments(): typeof this.hasSegments {
    return this.hasSegments;
  }

  /**
   * Get effective cuts for rendering (converts segments if in keep mode)
   */
  getEffectiveCuts(): typeof this.effectiveCuts {
    return this.effectiveCuts;
  }

  /**
   * Reset timeline
   */
  reset(): void {
    this.trimStart.set(0);
    this.trimEnd.set(0);
    this.cuts.set([]);
    this.segments.set([]);
    this.cutSelection.set({ start: 0, end: 0 });
    this.segmentSelection.set({ start: 0, end: 0 });
    this.timelineSelection.set(null);
    this.mode.set('cut');
  }
}

