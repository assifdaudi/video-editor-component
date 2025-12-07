import { probeMpdMetadata } from './ffmpeg.utils';
import { mpdConfig } from './config.utils';
import type { TimeRange } from '../types';

/**
 * Video metadata and validation utilities
 */

/**
 * Check if URL is an MPD stream
 */
export function isMpdUrl(url: string): boolean {
  return url.toLowerCase().endsWith('.mpd');
}

/**
 * Validate MPD stream against restrictions (if enabled)
 */
export async function validateMpdRestrictions(url: string): Promise<void> {
  if (!mpdConfig.enableRestrictions) {
    return;
  }

  console.log(`[validateMpdRestrictions] Checking restrictions for: ${url}`);

  try {
    const metadata = await probeMpdMetadata(url);
    console.log(`[validateMpdRestrictions] Metadata: duration=${metadata.duration}s, resolution=${metadata.width}x${metadata.height}`);

    if (metadata.duration > mpdConfig.maxVideoDurationSeconds) {
      throw new Error(
        `MPD stream duration (${Math.round(metadata.duration)}s) exceeds maximum allowed (${mpdConfig.maxVideoDurationSeconds}s)`
      );
    }

    if (metadata.width > mpdConfig.maxVideoWidth || metadata.height > mpdConfig.maxVideoHeight) {
      throw new Error(
        `MPD stream resolution (${metadata.width}x${metadata.height}) exceeds maximum allowed (${mpdConfig.maxVideoWidth}x${mpdConfig.maxVideoHeight})`
      );
    }

    console.log(`[validateMpdRestrictions] Validation passed`);
  } catch (err) {
    throw new Error(`MPD validation failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
  }
}

/**
 * Calculate segments to keep after applying cuts
 */
export function calculateKeepSegments(
  trimStart: number,
  trimEnd: number,
  cuts: TimeRange[]
): TimeRange[] {
  const sortedCuts = [...cuts].sort((a, b) => a.start - b.start);
  const segments: TimeRange[] = [];
  let currentStart = trimStart;

  for (const cut of sortedCuts) {
    if (cut.start > currentStart) {
      segments.push({ start: currentStart, end: Math.min(cut.start, trimEnd) });
    }
    currentStart = Math.max(currentStart, cut.end);
  }

  if (currentStart < trimEnd) {
    segments.push({ start: currentStart, end: trimEnd });
  }

  return segments;
}

/**
 * Format seconds as HH:MM:SS.mmm
 */
export function formatTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toFixed(3).padStart(6, '0')}`;
}

