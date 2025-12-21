import { InjectionToken } from '@angular/core';

/**
 * Injection token for the API base URL
 * Provide this in your app's root or feature module:
 * 
 * @example
 * providers: [
 *   { provide: VIDEO_EDITOR_API_BASE_URL, useValue: 'http://localhost:4000' }
 * ]
 */
export const VIDEO_EDITOR_API_BASE_URL = new InjectionToken<string>(
  'VIDEO_EDITOR_API_BASE_URL',
  {
    providedIn: 'root',
    factory: () => 'http://localhost:4000' // Default value
  }
);

