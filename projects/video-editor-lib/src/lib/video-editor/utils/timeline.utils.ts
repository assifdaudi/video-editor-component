import type { TimelineCut, TimelineSegment } from '../video-editor.types';

/**
 * Timeline calculation utilities for handling cuts
 */

/**
 * Check if a time overlaps with any cut segment
 * @param time The time to check
 * @param cuts Array of cut segments
 * @returns true if the time falls within any cut
 */
export function isTimeInCut(time: number, cuts: TimelineCut[]): boolean {
  return cuts.some(cut => time >= cut.start && time < cut.end);
}

/**
 * Check if a time range overlaps with any cut segment
 * @param start Start time of the range
 * @param end End time of the range
 * @param cuts Array of cut segments
 * @returns true if any part of the range overlaps with cuts
 */
export function isRangeInCut(start: number, end: number, cuts: TimelineCut[]): boolean {
  return cuts.some(cut => {
    const startInCut = start >= cut.start && start < cut.end;
    const endInCut = end > cut.start && end <= cut.end;
    const rangeContainsCut = start <= cut.start && end >= cut.end;
    const overlaps = startInCut || endInCut || rangeContainsCut;
    
    if (overlaps) {
      console.log(`[isRangeInCut] Overlap detected:`, {
        overlayRange: [start, end],
        cutRange: [cut.start, cut.end],
        startInCut,
        endInCut,
        rangeContainsCut
      });
    }
    
    return overlaps;
  });
}

/**
 * Calculate the adjusted time accounting for cuts
 * When cuts are removed, timeline positions shift left by the duration of cuts before them
 * @param originalTime The time in the original timeline (with cuts)
 * @param cuts Array of cut segments
 * @returns The adjusted time in the final timeline (after cuts are removed)
 */
export function calculateAdjustedTime(originalTime: number, cuts: TimelineCut[]): number {
  if (cuts.length === 0) {
    return originalTime;
  }

  // Sort cuts by start time
  const sortedCuts = [...cuts].sort((a, b) => a.start - b.start);
  
  let adjustment = 0;
  
  for (const cut of sortedCuts) {
    if (originalTime <= cut.start) {
      // Time is before this cut, no more adjustments needed
      break;
    }
    
    if (originalTime >= cut.end) {
      // Time is after this cut, subtract the cut duration
      adjustment += (cut.end - cut.start);
    } else {
      // Time is within this cut - this shouldn't happen if validation works
      // But if it does, snap to the cut start
      return cut.start - adjustment;
    }
  }
  
  return originalTime - adjustment;
}

/**
 * Calculate the original timeline time from an adjusted time
 * Inverse of calculateAdjustedTime - useful for mapping back from rendered video
 * @param adjustedTime The time in the final timeline (after cuts)
 * @param cuts Array of cut segments
 * @returns The original time in the timeline (with cuts)
 */
export function calculateOriginalTime(adjustedTime: number, cuts: TimelineCut[]): number {
  if (cuts.length === 0) {
    return adjustedTime;
  }

  const sortedCuts = [...cuts].sort((a, b) => a.start - b.start);
  
  let originalTime = adjustedTime;
  
  for (const cut of sortedCuts) {
    if (originalTime < cut.start) {
      // Haven't reached this cut yet
      break;
    }
    
    // Add back the cut duration
    originalTime += (cut.end - cut.start);
  }
  
  return originalTime;
}

/**
 * Get total duration removed by cuts
 * @param cuts Array of cut segments
 * @returns Total seconds removed
 */
export function getTotalCutDuration(cuts: TimelineCut[]): number {
  return cuts.reduce((total, cut) => total + (cut.end - cut.start), 0);
}

/**
 * Find the nearest valid time that's not in a cut
 * @param time The desired time
 * @param cuts Array of cut segments
 * @returns The nearest time that's not in a cut
 */
export function findNearestValidTime(time: number, cuts: TimelineCut[]): number {
  if (!isTimeInCut(time, cuts)) {
    return time;
  }
  
  // Find which cut this time is in
  const cut = cuts.find(c => time >= c.start && time < c.end);
  
  if (!cut) {
    return time;
  }
  
  // Snap to the start of the cut (before it)
  // This way overlays get placed just before the cut
  return cut.start;
}

/**
 * Validate that an overlay time range doesn't overlap with cuts
 * @param start Overlay start time
 * @param end Overlay end time
 * @param cuts Array of cut segments
 * @returns Object with isValid boolean and error message if invalid
 */
export function validateOverlayTimes(
  start: number,
  end: number,
  cuts: TimelineCut[]
): { isValid: boolean; error?: string } {
  console.log(`[validateOverlayTimes] Checking overlay [${start}s - ${end}s] against ${cuts.length} cuts`);
  
  if (isRangeInCut(start, end, cuts)) {
    console.log(`[validateOverlayTimes] ❌ BLOCKED - Overlay overlaps with cut`);
    return {
      isValid: false,
      error: 'Overlay cannot be placed in a cut region. Cuts will be removed from the final video.'
    };
  }
  
  console.log(`[validateOverlayTimes] ✅ VALID - Overlay does not overlap with cuts`);
  return { isValid: true };
}

/**
 * Convert segments (keep mode) to cuts (remove mode)
 * @param segments Array of segments to keep
 * @param trimStart Start of trim range
 * @param trimEnd End of trim range
 * @returns Array of cuts representing everything NOT in segments
 */
export function segmentsToCuts(
  segments: TimelineSegment[],
  trimStart: number,
  trimEnd: number
): TimelineCut[] {
  if (segments.length === 0) {
    // If no segments, cut everything
    return [{ id: 0, start: trimStart, end: trimEnd }];
  }

  const sortedSegments = [...segments].sort((a, b) => a.start - b.start);
  const cuts: TimelineCut[] = [];
  let currentPos = trimStart;

  for (const segment of sortedSegments) {
    // Add a cut before this segment if there's a gap
    if (currentPos < segment.start) {
      cuts.push({
        id: cuts.length,
        start: currentPos,
        end: segment.start
      });
    }
    currentPos = segment.end;
  }

  // Add a cut after the last segment if there's a gap
  if (currentPos < trimEnd) {
    cuts.push({
      id: cuts.length,
      start: currentPos,
      end: trimEnd
    });
  }

  return cuts;
}

/**
 * Convert cuts (remove mode) to segments (keep mode)
 * @param cuts Array of cuts to remove
 * @param trimStart Start of trim range
 * @param trimEnd End of trim range
 * @returns Array of segments representing everything NOT in cuts
 */
export function cutsToSegments(
  cuts: TimelineCut[],
  trimStart: number,
  trimEnd: number
): TimelineSegment[] {
  if (cuts.length === 0) {
    // If no cuts, keep everything
    return [{ id: 0, start: trimStart, end: trimEnd }];
  }

  const sortedCuts = [...cuts].sort((a, b) => a.start - b.start);
  const segments: TimelineSegment[] = [];
  let currentPos = trimStart;

  for (const cut of sortedCuts) {
    // Add a segment before this cut if there's a gap
    if (currentPos < cut.start) {
      segments.push({
        id: segments.length,
        start: currentPos,
        end: cut.start
      });
    }
    currentPos = cut.end;
  }

  // Add a segment after the last cut if there's a gap
  if (currentPos < trimEnd) {
    segments.push({
      id: segments.length,
      start: currentPos,
      end: trimEnd
    });
  }

  return segments;
}

/**
 * Check if a time is within any segment (keep mode)
 * @param time The time to check
 * @param segments Array of segments to keep
 * @returns true if the time falls within any segment
 */
export function isTimeInSegment(time: number, segments: TimelineSegment[]): boolean {
  return segments.some(segment => time >= segment.start && time < segment.end);
}

/**
 * Check if a time range is completely within segments (keep mode)
 * @param start Start time of the range
 * @param end End time of the range
 * @param segments Array of segments to keep
 * @returns true if the entire range is within segments
 */
export function isRangeInSegments(start: number, end: number, segments: TimelineSegment[]): boolean {
  // Check if the entire range is within at least one segment
  return segments.some(segment => start >= segment.start && end <= segment.end);
}

/**
 * Validate that an overlay time range is within segments (keep mode)
 * @param start Overlay start time
 * @param end Overlay end time
 * @param segments Array of segments to keep
 * @returns Object with isValid boolean and error message if invalid
 */
export function validateOverlayTimesForSegments(
  start: number,
  end: number,
  segments: TimelineSegment[]
): { isValid: boolean; error?: string } {
  console.log(`[validateOverlayTimesForSegments] Checking overlay [${start}s - ${end}s] against ${segments.length} segments`);
  
  if (!isRangeInSegments(start, end, segments)) {
    console.log(`[validateOverlayTimesForSegments] ❌ BLOCKED - Overlay not within kept segments`);
    return {
      isValid: false,
      error: 'Overlay must be placed within a segment that will be kept in the final video.'
    };
  }
  
  console.log(`[validateOverlayTimesForSegments] ✅ VALID - Overlay is within kept segments`);
  return { isValid: true };
}

