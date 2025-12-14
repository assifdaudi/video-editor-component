import { Injectable, signal, computed } from '@angular/core';
import type { AudioSource, TimelineCut } from '../video-editor.types';
import { calculateAdjustedTime, isRangeInCut } from '../utils/timeline.utils';

/**
 * Service for managing audio sources and timeline
 */
@Injectable({
  providedIn: 'root'
})
export class AudioService {
  // State
  protected readonly audioSources = signal<AudioSource[]>([]);
  protected readonly masterVolume = signal(1); // Master volume (0-1)
  protected readonly audioMixMode = signal<'mix' | 'replace'>('mix'); // Mix with video audio or replace it

  // Computed
  protected readonly hasAudio = computed(() => this.audioSources().length > 0);
  protected readonly activeAudioSources = computed(() => {
    const sources = this.audioSources();
    const hasSolo = sources.some(s => s.solo);
    
    if (hasSolo) {
      // If any track is solo, only return solo tracks
      return sources.filter(s => s.solo && !s.muted);
    }
    
    // Otherwise return all non-muted tracks
    return sources.filter(s => !s.muted);
  });

  private audioCounter = 0;

  /**
   * Add an audio source
   */
  addAudioSource(
    url: string,
    startTime: number,
    duration: number,
    volume: number = 1,
    originalDuration?: number
  ): { success: boolean; error?: string; audioId?: number } {
    // Validate URL
    if (!url || !url.trim()) {
      return { success: false, error: 'Audio URL is required' };
    }

    // Validate format (basic check - will be validated on backend)
    const audioExtensions = ['.mp3', '.wav', '.aac', '.ogg', '.m4a', '.flac', '.opus'];
    const urlLower = url.toLowerCase();
    const hasValidExtension = audioExtensions.some(ext => urlLower.includes(ext));
    
    if (!hasValidExtension && !urlLower.startsWith('http')) {
      return { 
        success: false, 
        error: 'Invalid audio format. Supported: MP3, WAV, AAC, OGG, M4A, FLAC, OPUS' 
      };
    }

    // Validate start time
    if (startTime < 0) {
      return { success: false, error: 'Start time cannot be negative' };
    }

    // Validate duration
    if (duration <= 0) {
      return { success: false, error: 'Duration must be greater than 0' };
    }

    // Validate volume
    if (volume < 0 || volume > 1) {
      return { success: false, error: 'Volume must be between 0 and 1' };
    }

    // Check for overlaps with existing audio sources
    const endTime = startTime + duration;
    const overlaps = this.audioSources().some(audio => {
      const audioEnd = audio.startTime + audio.duration;
      return (
        (startTime >= audio.startTime && startTime < audioEnd) ||
        (endTime > audio.startTime && endTime <= audioEnd) ||
        (startTime <= audio.startTime && endTime >= audioEnd)
      );
    });

    if (overlaps) {
      return { success: false, error: 'Audio sources cannot overlap' };
    }

    const originalDur = originalDuration ?? duration;
    const newAudio: AudioSource = {
      id: ++this.audioCounter,
      url: url.trim(),
      startTime,
      duration,
      originalDuration: originalDur, // Store original duration
      originalStartTime: startTime, // Store original timeline position
      audioTrimStart: 0, // Start from beginning of audio file
      audioTrimEnd: originalDur, // End at full duration
      volume,
      muted: false,
      solo: false,
      order: this.audioSources().length
    };

    this.audioSources.set([...this.audioSources(), newAudio].sort((a, b) => a.startTime - b.startTime));
    return { success: true, audioId: newAudio.id };
  }

  /**
   * Remove an audio source
   */
  removeAudioSource(id: number): void {
    const current = this.audioSources();
    const filtered = current.filter(a => a.id !== id);
    // Reorder remaining sources
    const reordered = filtered.map((a, index) => ({ ...a, order: index }));
    this.audioSources.set(reordered);
  }

  /**
   * Update audio source position
   */
  updateAudioPosition(id: number, newStartTime: number, maxDuration: number): { success: boolean; error?: string } {
    const audio = this.audioSources().find(a => a.id === id);
    if (!audio) {
      return { success: false, error: 'Audio source not found' };
    }

    if (newStartTime < 0) {
      return { success: false, error: 'Start time cannot be negative' };
    }

    // Check if new position would cause overlap
    const endTime = newStartTime + audio.duration;
    if (endTime > maxDuration) {
      // Shorten duration to fit within video
      const adjustedDuration = maxDuration - newStartTime;
      if (adjustedDuration <= 0) {
        return { success: false, error: 'Audio would be completely outside video duration' };
      }
      
      // Update both position and duration
      this.updateAudioSource(id, { startTime: newStartTime, duration: adjustedDuration });
      return { success: true };
    }

    const overlaps = this.audioSources().some(a => {
      if (a.id === id) return false;
      const audioEnd = a.startTime + a.duration;
      return (
        (newStartTime >= a.startTime && newStartTime < audioEnd) ||
        (endTime > a.startTime && endTime <= audioEnd) ||
        (newStartTime <= a.startTime && endTime >= audioEnd)
      );
    });

    if (overlaps) {
      return { success: false, error: 'Audio sources cannot overlap' };
    }

    this.updateAudioSource(id, { startTime: newStartTime });
    return { success: true };
  }

  /**
   * Update audio source properties
   */
  updateAudioSource(id: number, updates: Partial<AudioSource>): void {
    const current = this.audioSources();
    const updated = current.map(a => 
      a.id === id ? { ...a, ...updates } : a
    );
    this.audioSources.set(updated);
  }

  /**
   * Update audio volume
   */
  setAudioVolume(id: number, volume: number): { success: boolean; error?: string } {
    if (volume < 0 || volume > 1) {
      return { success: false, error: 'Volume must be between 0 and 1' };
    }
    this.updateAudioSource(id, { volume });
    return { success: true };
  }

  /**
   * Toggle mute for an audio source
   */
  toggleMute(id: number): void {
    const audio = this.audioSources().find(a => a.id === id);
    if (audio) {
      this.updateAudioSource(id, { muted: !audio.muted });
    }
  }

  /**
   * Toggle solo for an audio source
   */
  toggleSolo(id: number): void {
    const audio = this.audioSources().find(a => a.id === id);
    if (audio) {
      const newSolo = !audio.solo;
      this.updateAudioSource(id, { solo: newSolo });
      
      // If enabling solo, disable solo on all other tracks
      if (newSolo) {
        const current = this.audioSources();
        const updated = current.map(a => 
          a.id !== id ? { ...a, solo: false } : a
        );
        this.audioSources.set(updated);
      }
    }
  }

  /**
   * Set master volume
   */
  setMasterVolume(volume: number): { success: boolean; error?: string } {
    if (volume < 0 || volume > 1) {
      return { success: false, error: 'Volume must be between 0 and 1' };
    }
    this.masterVolume.set(volume);
    return { success: true };
  }

  /**
   * Set audio mix mode
   */
  setAudioMixMode(mode: 'mix' | 'replace'): void {
    this.audioMixMode.set(mode);
  }

  /**
   * Adjust audio positions when cuts are applied
   * Audio is tied to video timeline - if video is cut, corresponding audio is also cut
   * This implements relative timing: audio moves with video content
   * 
   * Behavior:
   * - If audio overlaps with any cut region, it is removed (audio is cut with video)
   * - If audio is after cuts, it shifts earlier by the total duration of cuts before it
   */
  adjustAudioForCuts(cuts: Array<{ start: number; end: number }>, videoDuration: number): void {
    if (cuts.length === 0) {
      return;
    }

    // Convert to TimelineCut format for utility functions
    const timelineCuts: TimelineCut[] = cuts.map((cut, index) => ({
      id: index,
      start: cut.start,
      end: cut.end
    }));

    const current = this.audioSources();
    const adjusted: AudioSource[] = [];

    console.log(`[AudioService] Adjusting ${current.length} audio source(s) for ${timelineCuts.length} cut(s)`);
    console.log(`[AudioService] Cuts:`, timelineCuts.map(c => `[${c.start}s - ${c.end}s]`));

    for (const audio of current) {
      // Use originalStartTime if available, otherwise use current startTime
      // This allows us to recalculate correctly even after previous adjustments
      const originalAudioStart = audio.originalStartTime ?? audio.startTime;
      let audioStart = originalAudioStart;
      let audioEnd = originalAudioStart + audio.duration;
      
      console.log(`[AudioService] Checking audio ${audio.id}: [${audioStart}s - ${audioEnd}s]`);
      
      // Find all cuts that overlap with this audio
      const overlappingCuts = timelineCuts.filter(cut => 
        audioStart < cut.end && audioEnd > cut.start
      );
      
      if (overlappingCuts.length === 0) {
        // No overlap - just adjust position
        const adjustedStart = calculateAdjustedTime(audioStart, timelineCuts);
        const adjustedEnd = calculateAdjustedTime(audioEnd, timelineCuts);
        const adjustedDuration = adjustedEnd - adjustedStart;

        if (adjustedDuration > 0 && adjustedStart >= 0) {
          const finalDuration = Math.min(adjustedDuration, videoDuration - adjustedStart);
          
          if (finalDuration > 0) {
            console.log(`[AudioService] Adjusting audio ${audio.id}: [${audioStart}s - ${audioEnd}s] -> [${adjustedStart}s - ${adjustedStart + finalDuration}s]`);
            adjusted.push({
              ...audio,
              startTime: adjustedStart,
              duration: finalDuration,
              originalStartTime: audioStart // Preserve original position for future adjustments
            });
          }
        }
        continue;
      }

      // Audio overlaps with cuts - trim the overlapping parts
      // Check if audio is completely within a cut
      const isCompletelyInCut = overlappingCuts.some(cut => 
        audioStart >= cut.start && audioEnd <= cut.end
      );
      
      if (isCompletelyInCut) {
        // Audio is completely removed
        console.log(`[AudioService] ❌ Removing audio ${audio.id} - completely within cut`);
        continue;
      }
      
      // Find all cut boundaries that affect this audio
      const cutBoundaries: number[] = [];
      overlappingCuts.forEach(cut => {
        cutBoundaries.push(cut.start);
        cutBoundaries.push(cut.end);
      });
      cutBoundaries.sort((a, b) => a - b);
      
      // Create segments: parts of audio that are NOT in cuts
      const segments: Array<{ start: number; end: number }> = [];
      let segmentStart = audioStart;
      
      for (const boundary of cutBoundaries) {
        if (boundary <= audioStart) continue;
        if (boundary >= audioEnd) break;
        
        // Check if this boundary starts a cut or ends a cut
        const startsCut = overlappingCuts.some(cut => cut.start === boundary);
        const endsCut = overlappingCuts.some(cut => cut.end === boundary);
        
        if (startsCut && segmentStart < boundary) {
          // We have a segment before this cut starts
          segments.push({ start: segmentStart, end: boundary });
          segmentStart = boundary; // Will be updated when cut ends
        } else if (endsCut) {
          // Cut ends here, start new segment after this
          segmentStart = boundary;
        }
      }
      
      // Add final segment if there's remaining audio after all cuts
      if (segmentStart < audioEnd) {
        segments.push({ start: segmentStart, end: audioEnd });
      }
      
      // Process each segment
      for (const segment of segments) {
        // Check if this segment is actually in a cut (shouldn't happen, but double-check)
        const segmentInCut = overlappingCuts.some(cut => 
          segment.start >= cut.start && segment.end <= cut.end
        );
        
        if (segmentInCut) {
          continue; // Skip segments that are in cuts
        }
        
        // Adjust this segment's position
        const adjustedSegmentStart = calculateAdjustedTime(segment.start, timelineCuts);
        const adjustedSegmentEnd = calculateAdjustedTime(segment.end, timelineCuts);
        const segmentDuration = adjustedSegmentEnd - adjustedSegmentStart;
        
        if (segmentDuration > 0 && adjustedSegmentStart >= 0) {
          const finalDuration = Math.min(segmentDuration, videoDuration - adjustedSegmentStart);
          
          if (finalDuration > 0) {
            const segmentId = segments.length > 1 ? audio.id + (segments.indexOf(segment) * 0.001) : audio.id;
            
            // Calculate which portion of the original audio file this segment represents
            // Segment times are in the original timeline, we need to map them to the audio file timeline
            const audioTrimStart = audio.audioTrimStart ?? 0;
            const audioTrimEnd = audio.audioTrimEnd ?? audio.originalDuration ?? audio.duration;
            const audioFileDuration = audioTrimEnd - audioTrimStart;
            
            // Calculate offset from the original audio's start time on the timeline
            const segmentOffsetFromAudioStart = segment.start - audioStart;
            const segmentEndOffsetFromAudioStart = segment.end - audioStart;
            
            // Map timeline offsets to audio file positions
            // The audio's timeline duration is audio.duration, and it maps to audioFileDuration in the file
            // Use audio.duration as the timeline duration (how long the audio plays on the timeline)
            const timelineDuration = audio.duration || audioFileDuration; // Fallback if duration is 0
            const segmentAudioTrimStart = audioTrimStart + (segmentOffsetFromAudioStart / timelineDuration) * audioFileDuration;
            const segmentAudioTrimEnd = audioTrimStart + (segmentEndOffsetFromAudioStart / timelineDuration) * audioFileDuration;
            
            console.log(`[AudioService] Keeping segment of audio ${audio.id}: [${segment.start}s - ${segment.end}s] -> [${adjustedSegmentStart}s - ${adjustedSegmentStart + finalDuration}s], audio file: [${segmentAudioTrimStart.toFixed(2)}s - ${segmentAudioTrimEnd.toFixed(2)}s]`);
            adjusted.push({
              ...audio,
              id: segmentId,
              startTime: adjustedSegmentStart,
              duration: finalDuration,
              originalStartTime: segment.start, // Store original timeline position for this segment
              audioTrimStart: segmentAudioTrimStart,
              audioTrimEnd: segmentAudioTrimEnd
            });
          }
        }
      }
    }

    console.log(`[AudioService] Audio adjustment complete: ${current.length} -> ${adjusted.length} tracks`);
    this.audioSources.set(adjusted);
  }

  /**
   * Get audio sources signal
   */
  getAudioSources(): typeof this.audioSources {
    return this.audioSources;
  }

  /**
   * Get master volume signal
   */
  getMasterVolume(): typeof this.masterVolume {
    return this.masterVolume;
  }

  /**
   * Get audio mix mode signal
   */
  getAudioMixMode(): typeof this.audioMixMode {
    return this.audioMixMode;
  }

  /**
   * Get has audio computed
   */
  getHasAudio(): typeof this.hasAudio {
    return this.hasAudio;
  }

  /**
   * Get active audio sources computed
   */
  getActiveAudioSources(): typeof this.activeAudioSources {
    return this.activeAudioSources;
  }

  /**
   * Reset audio service
   */
  reset(): void {
    this.audioSources.set([]);
    this.masterVolume.set(1);
    this.audioMixMode.set('mix');
    this.audioCounter = 0;
  }
}

