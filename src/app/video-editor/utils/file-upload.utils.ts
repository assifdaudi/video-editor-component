/**
 * File upload and validation utilities
 */

/**
 * Check if a file is a valid source file (video or image)
 */
export function isValidSourceFile(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false;

  const items = Array.from(dataTransfer.items);
  if (items.length === 0) return false;

  const item = items[0];
  if (item.kind !== 'file') return false;

  const file = item.getAsFile();
  if (!file) return false;

  const name = file.name.toLowerCase();
  const validExtensions = ['.mp4', '.m4v', '.mpd', '.jpg', '.jpeg', '.png', '.gif', '.webp'];
  return validExtensions.some(ext => name.endsWith(ext));
}

/**
 * Check if a file is a valid audio file
 */
export function isValidAudioFile(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false;

  const items = Array.from(dataTransfer.items);
  if (items.length === 0) return false;

  const item = items[0];
  if (item.kind !== 'file') return false;

  const file = item.getAsFile();
  if (!file) return false;

  const name = file.name.toLowerCase();
  const validExtensions = ['.mp3', '.wav', '.ogg', '.aac', '.m4a', '.flac', '.opus'];
  return validExtensions.some(ext => name.endsWith(ext));
}

/**
 * Check if a file is a valid image file
 */
export function isValidImageFile(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false;

  const items = Array.from(dataTransfer.items);
  if (items.length === 0) return false;

  const item = items[0];
  if (item.kind !== 'file') return false;

  const file = item.getAsFile();
  if (!file) return false;

  const name = file.name.toLowerCase();
  const validExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
  return validExtensions.some(ext => name.endsWith(ext));
}

/**
 * Create object URL for local file preview
 */
export function createLocalFileUrl(file: File): string {
  return URL.createObjectURL(file);
}

/**
 * Revoke object URL to prevent memory leaks
 */
export function revokeLocalFileUrl(url: string): void {
  URL.revokeObjectURL(url);
}

