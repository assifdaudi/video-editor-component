import { Injectable, signal, computed } from '@angular/core';
import type { TimelineCut } from '../video-editor.types';

/**
 * Service for managing timeline state (cuts, trim points)
 */
@Injectable({
  providedIn: 'root'
})
export class TimelineService {
  // State
  protected readonly trimStart = signal(0);
  protected readonly trimEnd = signal(0);
  protected readonly cuts = signal<TimelineCut[]>([]);
  protected readonly cutSelection = signal({ start: 0, end: 0 });
  protected readonly timelineSelection = signal<{ start: number; end: number } | null>(null);

  // Computed
  protected readonly trimmedLength = computed(
    () => Math.max(this.trimEnd() - this.trimStart(), 0)
  );
  
  protected readonly hasCuts = computed(() => this.cuts().length > 0);

  private cutCounter = 0;
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
    this.cuts.update(cuts => cuts.filter(c => c.id !== id));
  }

  /**
   * Clear all cuts
   */
  clearAllCuts(): void {
    this.cuts.set([]);
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
   * Reset timeline
   */
  reset(): void {
    this.trimStart.set(0);
    this.trimEnd.set(0);
    this.cuts.set([]);
    this.cutSelection.set({ start: 0, end: 0 });
    this.timelineSelection.set(null);
  }
}

