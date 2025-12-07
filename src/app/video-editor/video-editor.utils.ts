/**
 * Video Editor Utility Functions
 * 
 * This file contains reusable utility functions for the VideoEditorComponent.
 */

/**
 * Formats a time value (in seconds) to a human-readable string
 * @param value - Time value in seconds
 * @returns Formatted time string (e.g., "1:23:45" or "5:30")
 * 
 * @example
 * formatTime(90) // "1:30"
 * formatTime(3665) // "1:01:05"
 */
export function formatTime(value: number): string {
  if (!isFinite(value)) {
    return '0:00';
  }
  const totalSeconds = Math.max(value, 0);
  const hours = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = Math.floor(totalSeconds % 60);
  const pad = (n: number): string => n.toString().padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(mins)}:${pad(secs)}` : `${mins}:${pad(secs)}`;
}

/**
 * Clamps a numeric value between a minimum and maximum value
 * @param value - The value to clamp
 * @param min - The minimum allowed value
 * @param max - The maximum allowed value
 * @returns The clamped value
 * 
 * @example
 * clamp(5, 0, 10) // 5
 * clamp(-5, 0, 10) // 0
 * clamp(15, 0, 10) // 10
 * clamp(NaN, 0, 10) // 0 (returns min for NaN)
 */
export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) {
    return min;
  }
  return Math.min(Math.max(value, min), max);
}

/**
 * Calculates the percentage position of a time value within a duration
 * @param time - Time value in seconds
 * @param duration - Total duration in seconds
 * @returns Percentage (0-100)
 * 
 * @example
 * timeToPercent(5, 10) // 50
 * timeToPercent(0, 10) // 0
 * timeToPercent(10, 10) // 100
 */
export function timeToPercent(time: number, duration: number): number {
  if (!duration) {
    return 0;
  }
  return (clamp(time, 0, duration) / duration) * 100;
}

/**
 * Checks if a URL is an image based on its extension
 * @param url - The URL to check
 * @returns True if the URL appears to be an image
 * 
 * @example
 * isImageUrl('https://example.com/photo.jpg') // true
 * isImageUrl('https://example.com/video.mp4') // false
 */
export function isImageUrl(url: string): boolean {
  const lowerUrl = url.toLowerCase();
  return !!lowerUrl.match(/\.(jpg|jpeg|png|gif|webp)$/);
}

/**
 * Checks if a URL is an MPD (MPEG-DASH) manifest file
 * @param url - The URL to check
 * @returns True if the URL appears to be an MPD file
 * 
 * @example
 * isMpdUrl('https://example.com/stream.mpd') // true
 * isMpdUrl('https://example.com/video.mp4') // false
 */
export function isMpdUrl(url: string): boolean {
  return url.toLowerCase().endsWith('.mpd');
}

/**
 * Validates that a duration value is valid (finite, positive number)
 * @param duration - Duration value to validate
 * @returns True if the duration is valid
 * 
 * @example
 * isValidDuration(5.5) // true
 * isValidDuration(0) // false
 * isValidDuration(NaN) // false
 * isValidDuration(Infinity) // false
 */
export function isValidDuration(duration: number): boolean {
  return !isNaN(duration) && isFinite(duration) && duration > 0;
}

/**
 * Converts percentage dimensions to pixels based on video dimensions
 * @param percent - Percentage value (0-100)
 * @param dimension - Video dimension (width or height) in pixels
 * @returns Pixel value
 * 
 * @example
 * percentToPixels(50, 1920) // 960
 * percentToPixels(25, 1080) // 270
 */
export function percentToPixels(percent: number, dimension: number): number {
  return Math.round((percent / 100) * dimension);
}

/**
 * Converts pixel dimensions to percentage based on video dimensions
 * @param pixels - Pixel value
 * @param dimension - Video dimension (width or height) in pixels
 * @returns Percentage value (0-100)
 * 
 * @example
 * pixelsToPercent(960, 1920) // 50
 * pixelsToPercent(270, 1080) // 25
 */
export function pixelsToPercent(pixels: number, dimension: number): number {
  if (!dimension) {
    return 0;
  }
  return Math.round((pixels / dimension) * 100);
}

