import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import type { VideoSource, TimelineCut, Overlay, RenderResponse, AudioSource } from '../video-editor.types';
import { calculateAdjustedTime } from '../utils/timeline.utils';

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
    overlays: Overlay[],
    audioSources: AudioSource[],
    audioMixMode: 'mix' | 'replace'
  ): Observable<RenderResponse> {
    // Adjust overlay times to account for cuts being removed
    const adjustedOverlays = overlays.map(overlay => {
      const adjustedStart = calculateAdjustedTime(overlay.start, cuts);
      const adjustedEnd = calculateAdjustedTime(overlay.end, cuts);
      
      console.log(`[RenderService] Adjusting overlay times:`, {
        original: [overlay.start, overlay.end],
        adjusted: [adjustedStart, adjustedEnd],
        type: overlay.type
      });
      
      return {
        ...overlay,
        start: adjustedStart,
        end: adjustedEnd
      };
    });

    // Adjust audio times to account for cuts being removed
    const adjustedAudioSources = audioSources.map(audio => {
      const adjustedStart = calculateAdjustedTime(audio.startTime, cuts);
      // Calculate adjusted end time
      const adjustedEnd = calculateAdjustedTime(audio.startTime + audio.duration, cuts);
      const adjustedDuration = adjustedEnd - adjustedStart;
      
      console.log(`[RenderService] Adjusting audio times:`, {
        original: [audio.startTime, audio.startTime + audio.duration],
        adjusted: [adjustedStart, adjustedEnd],
        duration: adjustedDuration
      });
      
      return {
        url: audio.url,
        startTime: adjustedStart,
        duration: Math.max(0, adjustedDuration),
        originalDuration: audio.originalDuration,
        audioTrimStart: audio.audioTrimStart,
        audioTrimEnd: audio.audioTrimEnd,
        volume: audio.volume,
        muted: audio.muted,
        solo: audio.solo
      };
    }).filter(audio => audio.duration > 0); // Remove audio that would have no duration after cuts

    const payload = {
      sources: sources.map(s => ({
        url: s.url,
        type: s.type,
        duration: s.type === 'image' ? s.duration : undefined
      })),
      trimStart,
      trimEnd,
      cuts: cuts.map(c => ({ start: c.start, end: c.end })),
      overlays: adjustedOverlays,
      audioSources: adjustedAudioSources,
      audioMixMode,
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

