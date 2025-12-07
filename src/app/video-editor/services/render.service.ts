import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import type { VideoSource, TimelineCut, Overlay, RenderResponse } from '../video-editor.types';

/**
 * Service for handling video rendering API calls
 */
@Injectable({
  providedIn: 'root'
})
export class RenderService {
  private readonly http = inject(HttpClient);
  private readonly apiBaseUrl = environment.apiBaseUrl;

  /**
   * Submit a render request to the backend
   */
  render(
    sources: VideoSource[],
    trimStart: number,
    trimEnd: number,
    cuts: TimelineCut[],
    overlays: Overlay[]
  ): Observable<RenderResponse> {
    const payload = {
      sources: sources.map(s => ({
        url: s.url,
        type: s.type,
        duration: s.type === 'image' ? s.duration : undefined
      })),
      trimStart,
      trimEnd,
      cuts: cuts.map(c => ({ start: c.start, end: c.end })),
      overlays,
      format: 'mp4' as const
    };

    return this.http.post<RenderResponse>(`${this.apiBaseUrl}/api/render`, payload);
  }

  /**
   * Get the full download URL for a rendered video
   */
  getDownloadUrl(outputFile: string): string {
    return `${this.apiBaseUrl}${outputFile}`;
  }
}

