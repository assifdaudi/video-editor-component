import { Injectable, signal, computed } from '@angular/core';
import * as dashjs from 'dashjs';
import type { VideoSource } from '../video-editor.types';

/**
 * Service for managing video playback and dash.js player
 */
@Injectable({
  providedIn: 'root'
})
export class VideoPlayerService {
  // State
  protected readonly sources = signal<VideoSource[]>([]);
  protected readonly currentSourceIndex = signal(0);
  protected readonly duration = signal(0);
  protected readonly currentTime = signal(0);
  protected readonly sourceLoaded = signal(false);
  
  // Computed
  protected readonly currentSource = computed(() => {
    const allSources = this.sources();
    const index = this.currentSourceIndex();
    return allSources[index];
  });

  private dashPlayer?: dashjs.MediaPlayerClass;
  private videoElement?: HTMLVideoElement;

  /**
   * Initialize the player with a video element
   */
  initialize(videoElement: HTMLVideoElement): void {
    this.videoElement = videoElement;
  }

  /**
   * Load sources into the player
   */
  loadSources(sources: VideoSource[]): void {
    this.sources.set(sources);
    this.currentSourceIndex.set(0);
    if (sources.length > 0) {
      this.loadSourceAtIndex(0);
      this.sourceLoaded.set(true);
    }
  }

  /**
   * Load a specific source by index
   */
  loadSourceAtIndex(index: number): void {
    const allSources = this.sources();
    if (index < 0 || index >= allSources.length || !this.videoElement) {
      return;
    }

    const source = allSources[index];
    
    // Clean up previous player
    if (this.dashPlayer) {
      this.dashPlayer.reset();
      this.dashPlayer = undefined;
    }

    // For images, hide video
    if (source.type === 'image') {
      console.log(`[VideoPlayer] Loading image source: ${source.url}`);
      this.videoElement.style.display = 'none';
      this.videoElement.pause();
      this.videoElement.src = '';
      this.currentSourceIndex.set(index);
      return;
    }

    // For videos, show and load
    this.videoElement.style.display = 'block';
    const url = source.url;
    const isMpd = url.toLowerCase().endsWith('.mpd');

    if (isMpd) {
      this.dashPlayer = dashjs.MediaPlayer().create();
      this.dashPlayer.initialize(this.videoElement, url, true);
    } else {
      this.videoElement.src = url;
      this.videoElement.load();
    }

    this.currentSourceIndex.set(index);
  }

  /**
   * Navigate to previous source
   */
  goToPrevious(): void {
    const currentIndex = this.currentSourceIndex();
    if (currentIndex > 0) {
      this.loadSourceAtIndex(currentIndex - 1);
      if (this.videoElement) {
        this.videoElement.currentTime = 0;
      }
    }
  }

  /**
   * Navigate to next source
   */
  goToNext(): void {
    const currentIndex = this.currentSourceIndex();
    const allSources = this.sources();
    if (currentIndex < allSources.length - 1) {
      this.loadSourceAtIndex(currentIndex + 1);
      if (this.videoElement) {
        this.videoElement.currentTime = 0;
      }
    }
  }

  /**
   * Jump to a source by timeline time
   */
  jumpToSourceByTime(time: number): void {
    const allSources = this.sources();
    for (let i = 0; i < allSources.length; i++) {
      const source = allSources[i];
      if (time >= source.startTime && time < source.startTime + source.duration) {
        this.loadSourceAtIndex(i);
        if (this.videoElement) {
          this.videoElement.currentTime = time - source.startTime;
        }
        break;
      }
    }
  }

  /**
   * Advance to next source (when current ends)
   */
  advanceToNext(): void {
    const nextIndex = this.currentSourceIndex() + 1;
    const allSources = this.sources();
    
    if (nextIndex < allSources.length) {
      this.loadSourceAtIndex(nextIndex);
      
      if (this.videoElement && !this.videoElement.paused) {
        setTimeout(() => this.videoElement?.play(), 100);
      }
    }
  }

  /**
   * Check if can go to previous source
   */
  canGoToPrevious(): boolean {
    return this.currentSourceIndex() > 0;
  }

  /**
   * Check if can go to next source
   */
  canGoToNext(): boolean {
    return this.currentSourceIndex() < this.sources().length - 1;
  }

  /**
   * Get current source
   */
  getCurrentSource(): VideoSource | undefined {
    const allSources = this.sources();
    return allSources[this.currentSourceIndex()];
  }

  /**
   * Update duration
   */
  setDuration(duration: number): void {
    this.duration.set(duration);
  }

  /**
   * Update current time
   */
  setCurrentTime(time: number): void {
    this.currentTime.set(time);
  }

  /**
   * Get sources signal
   */
  getSources(): typeof this.sources {
    return this.sources;
  }

  /**
   * Get current source index signal
   */
  getCurrentSourceIndex(): typeof this.currentSourceIndex {
    return this.currentSourceIndex;
  }

  /**
   * Get duration signal
   */
  getDuration(): typeof this.duration {
    return this.duration;
  }

  /**
   * Get current time signal
   */
  getCurrentTime(): typeof this.currentTime {
    return this.currentTime;
  }

  /**
   * Get source loaded signal
   */
  getSourceLoaded(): typeof this.sourceLoaded {
    return this.sourceLoaded;
  }

  /**
   * Cleanup
   */
  cleanup(): void {
    if (this.dashPlayer) {
      try {
        this.dashPlayer.reset();
      } catch (error) {
        console.error('Error cleaning up dash.js player:', error);
      }
      this.dashPlayer = undefined;
    }
  }
}

