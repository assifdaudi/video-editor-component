import { CommonModule } from '@angular/common';
import {
  ChangeDetectorRef,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
  computed,
  inject,
  signal
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { ReactiveFormsModule, Validators, FormBuilder } from '@angular/forms';
import * as dashjs from 'dashjs';
import { environment } from '../../environments/environment';
import {
  VideoSource,
  TimelineCut,
  TimelineSegment,
  Overlay,
  RenderResponse,
  TimelineDrag,
  VideoBounds,
  AudioSource,
  AudioTimelineDrag
} from './video-editor.types';
import { formatTime, clamp } from './video-editor.utils';
import { 
  RenderService, 
  VideoPlayerService, 
  OverlayService, 
  TimelineService,
  AudioService
} from './services';

@Component({
  selector: 'app-video-editor',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './video-editor.component.html',
  styleUrl: './video-editor.component.scss'
})
export class VideoEditorComponent implements OnDestroy {
  // ViewChild decorators
  @ViewChild('videoEl', { static: true }) private videoElement?: ElementRef<HTMLVideoElement>;
  @ViewChild('overlayFormContainer', { static: false }) private overlayFormContainer?: ElementRef<HTMLElement>;
  @ViewChild('playerContainer', { static: false }) private playerContainer?: ElementRef<HTMLElement>;
  // Removed file input ViewChilds - using direct DOM queries for better performance

  // Private fields (dependencies that must be declared first)
  private readonly fb = inject(FormBuilder);
  private readonly http = inject(HttpClient);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly renderService = inject(RenderService);
  private readonly playerService = inject(VideoPlayerService);
  private readonly overlayService = inject(OverlayService);
  private readonly timelineService = inject(TimelineService);
  private readonly audioService = inject(AudioService);

  /* eslint-disable @typescript-eslint/member-ordering */
  // Protected fields (must come after fb/http due to dependencies)
  protected readonly backendHost = environment.apiBaseUrl;

  protected readonly sourceForm = this.fb.nonNullable.group({
    sourceUrl: ['', [Validators.required]],
    imageDuration: [5, [Validators.required, Validators.min(0.1), Validators.max(60)]]
  });

  // Track if current URL is an image
  protected readonly isImageUrl = computed(() => {
    const url = this.sourceForm.controls.sourceUrl.value.toLowerCase();
    return !!url.match(/\.(jpg|jpeg|png|gif|webp)$/);
  });

  // UI-specific state (stays in component)
  protected readonly loading = signal(false);
  protected readonly errorMessage = signal('');
  protected readonly sourceBoundaries = signal<number[]>([]); // Cumulative timestamps where sources end
  protected readonly editingSourceId = signal<number | null>(null); // ID of source being edited
  protected readonly showOverlayForm = signal(false);
  protected readonly overlayFormType = signal<'text' | 'image' | 'shape'>('text');
  protected readonly showAudioForm = signal(false);
  protected readonly showCutForm = signal(false);
  protected readonly editingAudioId = signal<number | null>(null);
  protected readonly renderBusy = signal(false);
  protected readonly renderResult = signal<RenderResponse | null>(null);
  protected readonly draggingOverlay = signal<{ overlay: Overlay; startX: number; startY: number; offsetX: number; offsetY: number } | null>(null);
  protected readonly resizingOverlay = signal<{ overlay: Overlay; startWidth: number; startHeight: number; startX: number; startY: number; corner: 'se' | 'sw' | 'ne' | 'nw' } | null>(null);
  
  // Drag and drop state
  protected readonly isDraggingSource = signal(false);
  protected readonly isDraggingAudio = signal(false);
  protected readonly isDraggingImage = signal(false);

  // Store local files (File objects) - only upload when rendering
  private readonly localFiles = new Map<string, File>(); // Map URL to File object
  private readonly objectUrls = new Map<string, string>(); // Map URL to object URL for cleanup

  // Track input values for drag-hint visibility
  protected readonly audioUrlValue = signal('');
  protected readonly imageUrlValue = signal('');

  // Service signals (delegated)
  protected readonly sources = this.playerService.getSources();
  protected readonly duration = this.playerService.getDuration();
  protected readonly currentTime = this.playerService.getCurrentTime();
  
  // Computed playhead position (uses preview time during drag for smooth movement)
  protected readonly playheadTime = computed(() => {
    return this.previewTime() !== null ? this.previewTime()! : this.currentTime();
  });
  protected readonly sourceLoaded = this.playerService.getSourceLoaded();
  protected readonly currentSourceIndex = this.playerService.getCurrentSourceIndex();
  
  protected readonly trimStart = this.timelineService.getTrimStart();
  protected readonly trimEnd = this.timelineService.getTrimEnd();
  // Use computed signals for display to ensure proper change detection
  protected readonly cuts = this.timelineService.getCutsForDisplay();
  protected readonly segments = this.timelineService.getSegmentsForDisplay();
  // Keep raw signals for operations that need to modify them
  private readonly cutsRaw = this.timelineService.getCuts();
  private readonly segmentsRaw = this.timelineService.getSegments();
  protected readonly cutSelection = this.timelineService.getCutSelection();
  protected readonly segmentSelection = this.timelineService.getSegmentSelection();
  protected readonly timelineSelection = this.timelineService.getTimelineSelection();
  protected readonly trimmedLength = this.timelineService.getTrimmedLength();
  protected readonly hasCuts = this.timelineService.getHasCuts();
  protected readonly hasSegments = this.timelineService.getHasSegments();
  protected readonly timelineMode = this.timelineService.getMode();
  
  protected readonly overlays = this.overlayService.getOverlays();
  protected readonly overlaySelection = this.overlayService.getSelectedOverlay();

  // Audio service signals
  protected readonly audioSources = this.audioService.getAudioSources();
  protected readonly masterVolume = this.audioService.getMasterVolume();
  protected readonly audioMixMode = this.audioService.getAudioMixMode();
  protected readonly hasAudio = this.audioService.getHasAudio();
  protected readonly activeAudioSources = this.audioService.getActiveAudioSources();

  protected readonly canRender = computed(
    () => this.sourceLoaded() && this.duration() > 0 && !this.loading()
  );

  protected hasOverlays = computed(() => this.overlays().length > 0);

  // Expose Math for template
  protected readonly Math = Math;

  /**
   * Calculate the height needed for the audio timeline based on number of tracks
   */
  protected readonly audioTimelineHeight = computed(() => {
    const audio = this.audioSources();
    if (audio.length === 0) return 56;

    // Find the maximum track index
    let maxTrackIndex = 0;
    for (const a of audio) {
      const trackIdx = this.getAudioTrackIndex(a);
      maxTrackIndex = Math.max(maxTrackIndex, trackIdx);
    }

    // Each track is 44px tall with 6px padding top and bottom
    return Math.max(56, 6 + (maxTrackIndex + 1) * 44 + 6);
  });
  /* eslint-enable @typescript-eslint/member-ordering */

  // Private fields (remaining)
  private readonly minGap = 0.1;
  private timelineDrag: TimelineDrag = null;
  private audioTimelineDrag: AudioTimelineDrag | null = null;
  private readonly previewTime = signal<number | null>(null); // Preview time during drag (for smooth playhead movement)
  private nextSourceId = 1;
  private isLoadingSource = false;
  private keyboardListener?: (event: KeyboardEvent) => void;
  private audioElements = new Map<number, HTMLAudioElement>(); // Map audio ID to audio element
  private audioPlaybackInterval?: number;

  // Constructor
  constructor() {
    // Set up keyboard shortcuts for source navigation
    this.keyboardListener = (event: KeyboardEvent): void => {
      // Handle Escape key to close forms (works even when typing in inputs)
      if (event.key === 'Escape') {
        if (this.showOverlayForm()) {
          event.preventDefault();
          this.closeOverlayForm();
          return;
        }
        if (this.showAudioForm()) {
          event.preventDefault();
          this.closeAudioForm();
          return;
        }
        if (this.showCutForm()) {
          event.preventDefault();
          this.closeCutForm();
          return;
        }
      }

      // Only handle if not typing in an input
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return;
      }

      if (event.key === 'ArrowLeft' && this.sources().length > 1) {
        event.preventDefault();
        this.goToPreviousSource();
      } else if (event.key === 'ArrowRight' && this.sources().length > 1) {
        event.preventDefault();
        this.goToNextSource();
      }
    };

    window.addEventListener('keydown', this.keyboardListener);
  }

  // Lifecycle hooks
  ngOnDestroy(): void {
    // Clean up video player service
    this.playerService.cleanup();
    
    // Clean up audio elements
    this.cleanupAudioElements();
    
    // Clean up audio playback interval
    if (this.audioPlaybackInterval) {
      clearInterval(this.audioPlaybackInterval);
    }
    
    // Clean up keyboard listener
    if (this.keyboardListener) {
      window.removeEventListener('keydown', this.keyboardListener);
    }

    // Clean up all object URLs
    this.objectUrls.forEach(url => {
      URL.revokeObjectURL(url);
    });
    this.objectUrls.clear();
    this.localFiles.clear();
  }

  // Protected methods
  /**
   * Add a new source to the timeline
   */
  protected async addSource(): Promise<void> {
    this.errorMessage.set('');
    if (this.sourceForm.invalid) {
      this.sourceForm.markAllAsTouched();
      return;
    }

    const rawValue = this.sourceForm.controls.sourceUrl.value ?? '';
    const url = rawValue.trim();

    if (!url) {
      this.errorMessage.set('Provide a valid MP4, MPD, or image URL.');
      return;
    }

    if (this.isLoadingSource) {
      this.errorMessage.set('Please wait for the current source to load.');
      return;
    }

    // Determine type based on extension
    const lowerUrl = url.toLowerCase();
    const isImage = lowerUrl.match(/\.(jpg|jpeg|png|gif|webp)$/);
    const isMpd = lowerUrl.endsWith('.mpd');
    const type: 'video' | 'image' = isImage ? 'image' : 'video';

    // Check if adding this source would mix MPD and MP4 formats
    if (type === 'video') {
      const currentSources = this.sources();
      const hasExistingMpd = currentSources.some(s => s.type === 'video' && s.url.toLowerCase().endsWith('.mpd'));
      const hasExistingMp4 = currentSources.some(s => s.type === 'video' && !s.url.toLowerCase().endsWith('.mpd'));
      
      // Check if we're about to mix formats
      const wouldMixFormats = (isMpd && hasExistingMp4) || (!isMpd && hasExistingMpd);
      
      if (wouldMixFormats && currentSources.length > 0) {
        // Show confirmation dialog
        const sourceType = isMpd ? 'MPD' : 'MP4';
        const existingType = hasExistingMpd ? 'MPD' : 'MP4';
        
        const confirmed = confirm(
          '⚠️ Quality Warning\n\n' +
          `You are about to add an ${sourceType} source to a timeline that already contains ${existingType} sources.\n\n` +
          'Mixing MPD and MP4 sources requires multiple encoding passes, which may significantly reduce video quality.\n\n' +
          'For best quality, use sources of the same format (all MPD or all MP4).\n\n' +
          'Do you want to continue anyway?'
        );
        
        if (!confirmed) {
          return; // User cancelled
        }
      }
    }

    this.isLoadingSource = true;
    this.loading.set(true);

    try {
      // Get duration of the source
      let duration = 5; // Default 5 seconds for images
      
      if (type === 'video') {
        // Load video metadata to get duration
        duration = await this.getVideoDuration(url);
        
        // Validate duration
        if (!duration || isNaN(duration) || !isFinite(duration) || duration <= 0) {
          throw new Error(`Invalid duration (${duration}) for video: ${url}`);
        }
      } else {
        // Use custom image duration from form
        duration = this.sourceForm.controls.imageDuration.value || 5;
      }

      const currentSources = this.sources();
      const startTime = currentSources.reduce((sum, s) => sum + s.duration, 0);

      const newSource: VideoSource = {
        id: this.nextSourceId++,
        url,
        type,
        duration,
        startTime,
        order: currentSources.length
      };

      this.sources.update(sources => [...sources, newSource]);
      this.updateSourceBoundaries();
      this.sourceForm.reset();
      
      // Load the concatenated sources for preview
      this.loadConcatenatedSources();
    } catch (error) {
      this.errorMessage.set(`Failed to load source: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      this.isLoadingSource = false;
      this.loading.set(false);
    }
  }

  /**
   * Remove a source from the timeline
   */
  protected removeSource(id: number): void {
    this.sources.update(sources => {
      const filtered = sources.filter(s => s.id !== id);
      // Re-calculate start times and order
      return this.recalculateSourceTimings(filtered);
    });
    
    this.updateSourceBoundaries();
    
    // Reload if we still have sources
    if (this.sources().length > 0) {
      this.loadConcatenatedSources();
    } else {
      this.resetEditor(true);
    }
  }

  /**
   * Move a source up in the order
   */
  protected moveSourceUp(id: number): void {
    const currentSources = this.sources();
    const index = currentSources.findIndex(s => s.id === id);
    
    if (index > 0) {
      const newSources = [...currentSources];
      [newSources[index - 1], newSources[index]] = [newSources[index], newSources[index - 1]];
      // Update order and timings
      const reordered = this.recalculateSourceTimings(newSources);
      this.sources.set(reordered);
      this.updateSourceBoundaries();
      this.loadConcatenatedSources();
    }
  }

  /**
   * Move a source down in the order
   */
  protected moveSourceDown(id: number): void {
    const currentSources = this.sources();
    const index = currentSources.findIndex(s => s.id === id);
    
    if (index < currentSources.length - 1) {
      const newSources = [...currentSources];
      [newSources[index], newSources[index + 1]] = [newSources[index + 1], newSources[index]];
      // Update order and timings
      const reordered = this.recalculateSourceTimings(newSources);
      this.sources.set(reordered);
      this.updateSourceBoundaries();
      this.loadConcatenatedSources();
    }
  }

  /**
   * Start editing a source's duration (images only)
   */
  protected startEditingSource(id: number): void {
    this.editingSourceId.set(id);
  }

  /**
   * Update a source's duration
   */
  protected updateSourceDuration(id: number, newDuration: number): void {
    const validDuration = Math.max(0.1, Math.min(60, newDuration));
    
    this.sources.update(sources => {
      const updated = sources.map(s => 
        s.id === id ? { ...s, duration: validDuration } : s
      );
      return this.recalculateSourceTimings(updated);
    });
    
    this.updateSourceBoundaries();
    this.editingSourceId.set(null);
    this.loadConcatenatedSources();
  }

  /**
   * Cancel editing a source
   */
  protected cancelEditingSource(): void {
    this.editingSourceId.set(null);
  }

  /**
   * Load and concatenate all sources for preview
   * Switches between sources during playback to simulate concatenation
   */
  protected loadConcatenatedSources(): void {
    const allSources = this.sources();
    if (allSources.length === 0) {
      return;
    }

    // Calculate total duration
    const totalDuration = allSources.reduce((sum, s) => sum + s.duration, 0);
    
    // Validate total duration
    if (isNaN(totalDuration) || !isFinite(totalDuration) || totalDuration <= 0) {
      this.errorMessage.set(`Invalid total duration (${totalDuration}). One or more sources have invalid durations. Please remove and re-add the sources.`);
      return;
    }
    
    // Reset services
    this.timelineService.reset();
    this.overlayService.clearAll();
    this.renderResult.set(null);
    
    // Set trim range to full duration
    this.timelineService.setTrimStart(0, totalDuration);
    this.timelineService.setTrimEnd(totalDuration, totalDuration);
    
    // Set cut and segment selection defaults
    const defaultStart = Math.min(totalDuration * 0.25, totalDuration - 0.1);
    const defaultEnd = Math.min(totalDuration * 0.4, totalDuration);
    this.timelineService.setCutSelection(defaultStart, defaultEnd);
    this.timelineService.setSegmentSelection(defaultStart, defaultEnd);
    
    // Initialize player with video element if not already done
    const video = this.videoElement?.nativeElement;
    if (video) {
      this.playerService.initialize(video);
    }
    
    // Load sources into player
    this.playerService.loadSources(allSources);
    this.playerService.setDuration(totalDuration);
  }

  /**
   * Navigate to previous source
   */
  protected goToPreviousSource(): void {
    this.playerService.goToPrevious();
  }

  /**
   * Navigate to next source
   */
  protected goToNextSource(): void {
    this.playerService.goToNext();
  }

  /**
   * Jump to a specific source by its start time (for clicking timeline boundaries)
   */
  protected jumpToSourceByTime(time: number): void {
    this.playerService.jumpToSourceByTime(time);
  }

  /**
   * Check if user can navigate to previous source
   */
  protected canGoToPreviousSource(): boolean {
    return this.playerService.canGoToPrevious();
  }

  /**
   * Check if user can navigate to next source
   */
  protected canGoToNextSource(): boolean {
    return this.playerService.canGoToNext();
  }

  /**
   * Get the current source being previewed
   */
  protected getCurrentSource(): VideoSource | undefined {
    return this.playerService.getCurrentSource();
  }

  /**
   * Legacy method - kept for backward compatibility
   */
  protected loadVideo(): void {
    this.addSource();
  }

  protected resetEditor(clearSource = false): void {
    if (clearSource) {
      this.sourceForm.reset();
      this.sources.set([]);
    }
    this.loading.set(false);
    this.sourceLoaded.set(false);
    this.renderBusy.set(false);
    this.renderResult.set(null);
    this.duration.set(0);
    this.currentTime.set(0);
    this.trimStart.set(0);
    this.trimEnd.set(0);
    this.cutsRaw.set([]);
    this.cutSelection.set({ start: 0, end: 0 });
    this.overlays.set([]);
    this.overlaySelection.set(null);
    this.showOverlayForm.set(false);
    this.timelineSelection.set(null);
    this.errorMessage.set('');

    const video = this.videoElement?.nativeElement;
    if (video) {
      video.pause();
      video.removeAttribute('src');
      video.load();
    }

    // Player cleanup handled by service
  }

  protected onMetadataLoaded(): void {
    // Initialize audio playback when video metadata is loaded
    this.initializeAudioPlayback();
    const video = this.videoElement?.nativeElement;
    if (!video) {
      return;
    }

    const duration = video.duration ?? 0;
    const allSources = this.sources();

    if (!isFinite(duration) || duration <= 0) {
      this.errorMessage.set(
        'Unable to detect duration. Streams without fixed length are not supported.'
      );
      return;
    }

    // If we have multiple sources, DON'T update duration/trimEnd
    // The concatenated timeline manages those values
    if (allSources.length <= 1) {
      // Single source or no sources - update duration
      this.duration.set(duration);
      this.trimStart.set(0);
      this.trimEnd.set(duration);
      this.cutSelection.set({
        start: Math.min(duration * 0.25, duration - this.minGap),
        end: Math.min(duration * 0.4, duration)
      });
    }
    // For multi-source, duration/trimEnd are already set by loadConcatenatedSources
    // Don't overwrite them here
  }

  protected onTimeUpdate(): void {
    const video = this.videoElement?.nativeElement;
    if (!video) {
      return;
    }

    const allSources = this.sources();
    const currentIndex = this.currentSourceIndex();

    if (allSources.length === 0) {
      this.currentTime.set(video.currentTime);
      return;
    }

    // Calculate global timeline position
    const currentSource = allSources[currentIndex];
    if (currentSource) {
      // For images, time doesn't advance automatically (static preview)
      if (currentSource.type === 'image') {
        // Keep time at the start of the image
        this.currentTime.set(currentSource.startTime);
        return;
      }

      const globalTime = currentSource.startTime + video.currentTime;
      this.currentTime.set(globalTime);

      // Check if we need to advance to next source
      if (video.currentTime >= currentSource.duration - 0.1) {
        this.advanceToNextSource();
      }
    } else {
      this.currentTime.set(video.currentTime);
    }
  }

  /**
   * Handle video ended event
   */
  protected onVideoEnded(): void {
    const currentSource = this.getCurrentSource();
    // Only auto-advance for videos, not images
    if (currentSource?.type === 'video') {
      this.advanceToNextSource();
    }
  }

  protected onVideoError(): void {
    this.errorMessage.set('Unable to load the provided source.');
  }

  protected updateTrimStart(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    this.timelineService.setTrimStart(value, this.duration());
  }

  protected updateTrimEnd(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    this.timelineService.setTrimEnd(value, this.duration());
  }

  protected setTrimStartFromCurrent(): void {
    this.timelineService.setTrimStart(this.currentTime(), this.duration());
  }

  protected setTrimEndFromCurrent(): void {
    this.timelineService.setTrimEnd(this.currentTime(), this.duration());
  }

  protected togglePlayPause(): void {
    const video = this.videoElement?.nativeElement;
    if (!video) {
      return;
    }
    if (video.paused) {
      void video.play();
      // Start audio playback
      this.initializeAudioPlayback();
    } else {
      video.pause();
      // Pause all audio
      this.audioElements.forEach(audioEl => {
        audioEl.pause();
      });
    }
  }

  protected jumpTo(time: number): void {
    const video = this.videoElement?.nativeElement;
    if (!video) {
      return;
    }

    const clampedTime = this.clamp(time, 0, this.duration());
    const allSources = this.sources();

    // If we have multiple sources, find the correct source and load it
    if (allSources.length > 1) {
      // Find which source this time belongs to
      let targetSourceIndex = 0;
      let localTime = clampedTime;

      for (let i = 0; i < allSources.length; i++) {
        const source = allSources[i];
        if (clampedTime >= source.startTime && clampedTime < source.startTime + source.duration) {
          targetSourceIndex = i;
          localTime = clampedTime - source.startTime;
          break;
        } else if (i === allSources.length - 1) {
          // Last source
          targetSourceIndex = i;
          localTime = clampedTime - source.startTime;
        }
      }

      // Load the target source if not already loaded
      if (this.currentSourceIndex() !== targetSourceIndex) {
        this.playerService.loadSourceAtIndex(targetSourceIndex);
        // Wait for video to load, then seek
        setTimeout(() => {
          video.currentTime = localTime;
        }, 200);
      } else {
        video.currentTime = localTime;
      }
    } else {
      // Single source or no sources
      video.currentTime = clampedTime;
    }
  }

  protected setCutStartFromCurrent(): void {
    const currentTime = this.currentTime();
    const start = this.clamp(
      currentTime,
      this.trimStart(),
      this.trimEnd() - this.minGap
    );
    
    if (this.timelineMode() === 'keep') {
      const nextEnd = Math.max(start + this.minGap, this.segmentSelection().end);
      this.timelineService.setSegmentSelection(
        start,
        this.clamp(nextEnd, start + this.minGap, this.trimEnd())
      );
    } else {
      const nextEnd = Math.max(start + this.minGap, this.cutSelection().end);
      this.timelineService.setCutSelection(
        start,
        this.clamp(nextEnd, start + this.minGap, this.trimEnd())
      );
    }
  }

  protected setCutEndFromCurrent(): void {
    const currentTime = this.currentTime();
    
    if (this.timelineMode() === 'keep') {
      const start = this.segmentSelection().start;
      this.timelineService.setSegmentSelection(
        start,
        this.clamp(currentTime, start + this.minGap, this.trimEnd())
      );
    } else {
      const start = this.cutSelection().start;
      this.timelineService.setCutSelection(
        start,
        this.clamp(currentTime, start + this.minGap, this.trimEnd())
      );
    }
  }

  protected updateCutSelection(field: 'start' | 'end', event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    
    if (this.timelineMode() === 'keep') {
      const current = this.segmentSelection();
      const next = { ...current };
      if (field === 'start') {
        next.start = this.clamp(value, this.trimStart(), next.end - this.minGap);
      } else {
        next.end = this.clamp(value, next.start + this.minGap, this.trimEnd());
      }
      this.timelineService.setSegmentSelection(next.start, next.end);
    } else {
      const current = this.cutSelection();
      const next = { ...current };
      if (field === 'start') {
        next.start = this.clamp(value, this.trimStart(), next.end - this.minGap);
      } else {
        next.end = this.clamp(value, next.start + this.minGap, this.trimEnd());
      }
      this.timelineService.setCutSelection(next.start, next.end);
    }
  }

  /**
   * Toggle between cut mode and keep mode
   */
  protected toggleTimelineMode(): void {
    const currentMode = this.timelineMode();
    this.timelineService.setMode(currentMode === 'cut' ? 'keep' : 'cut');
    this.errorMessage.set('');
  }

  /**
   * Add a cut or segment based on current mode
   */
  protected addCut(): void {
    if (this.timelineMode() === 'keep') {
      const { start, end } = this.segmentSelection();
      const result = this.timelineService.addSegment(start, end);
      if (!result.success && result.error) {
        this.errorMessage.set(result.error);
      } else {
        this.adjustAudioForCuts();
      }
    } else {
      const { start, end } = this.cutSelection();
      const result = this.timelineService.addCut(start, end);
      if (!result.success && result.error) {
        this.errorMessage.set(result.error);
      } else {
        this.adjustAudioForCuts();
      }
    }
  }

  /**
   * Add a segment (keep mode)
   */
  protected addSegment(): void {
    const { start, end } = this.segmentSelection();
    const result = this.timelineService.addSegment(start, end);
    if (!result.success && result.error) {
      this.errorMessage.set(result.error);
    } else {
      // Adjust audio for the new segment (which creates cuts around it)
      this.adjustAudioForCuts();
    }
  }

  protected removeCut(id: number): void {
    // Get the cut before deleting to check selection
    const cut = this.cutsRaw().find(c => c.id === id);
    const selection = this.cutSelection();
    
    this.timelineService.deleteCut(id);
    
    // Clear selection if the deleted cut was selected
    if (cut && selection.start === cut.start && selection.end === cut.end) {
      this.timelineService.setCutSelection(0, 0);
    }
    
    // Adjust audio positions
    this.adjustAudioForCuts();
  }

  protected removeSegment(id: number): void {
    // Get the segment before deleting to check selection
    const segment = this.segmentsRaw().find(s => s.id === id);
    const selection = this.segmentSelection();
    
    this.timelineService.deleteSegment(id);
    
    // Clear selection if the deleted segment was selected
    if (segment && selection.start === segment.start && selection.end === segment.end) {
      this.timelineService.setSegmentSelection(0, 0);
    }
    
    // Adjust audio positions
    this.adjustAudioForCuts();
  }

  protected removeCutFromTimeline(id: number, event?: Event): void {
    event?.stopPropagation();
    this.removeCut(id);
  }

  protected removeSegmentFromTimeline(id: number, event?: Event): void {
    event?.stopPropagation();
    this.removeSegment(id);
  }

  protected focusCut(cut: TimelineCut, event?: Event): void {
    event?.stopPropagation();
    this.timelineService.setCutSelection(cut.start, cut.end);
  }

  protected focusSegment(segment: TimelineSegment, event?: Event): void {
    event?.stopPropagation();
    this.timelineService.setSegmentSelection(segment.start, segment.end);
  }

  protected formatTime(value: number): string {
    return formatTime(value);
  }

  protected exportPlan(): string[] {
    const plan: string[] = [];
    plan.push(
      `Trim video from ${this.formatTime(this.trimStart())} to ${this.formatTime(this.trimEnd())}.`
    );
    if (this.cuts().length === 0) {
      plan.push('No middle cuts defined.');
    } else {
      this.cuts().forEach(cut =>
        plan.push(
          `Remove segment ${this.formatTime(cut.start)} - ${this.formatTime(cut.end)}.`
        )
      );
    }
    return plan;
  }

  /**
   * Get the left position percentage for an audio clip, ensuring it doesn't go negative
   */
  protected getAudioClipLeft(audio: AudioSource): number {
    return Math.max(0, this.percentFor(audio.startTime));
  }

  /**
   * Get the width percentage for an audio clip, ensuring it doesn't extend beyond the timeline
   */
  protected getAudioClipWidth(audio: AudioSource): number {
    const left = this.getAudioClipLeft(audio);
    const endTime = audio.startTime + audio.duration;
    const endPercent = Math.min(100, this.percentFor(endTime));
    return Math.max(0, Math.min(endPercent - left, 100 - left));
  }

  /**
   * Calculate vertical track index for audio clips to stack overlapping clips
   */
  protected getAudioTrackIndex(audio: AudioSource): number {
    const allAudio = this.audioSources();
    const currentIndex = allAudio.findIndex(a => a.id === audio.id);
    if (currentIndex === -1) return 0;

    // Find all audio clips that overlap with this one
    const overlapping: number[] = [];
    const currentStart = audio.startTime;
    const currentEnd = audio.startTime + audio.duration;

    for (let i = 0; i < currentIndex; i++) {
      const other = allAudio[i];
      if (!other) continue;
      const otherStart = other.startTime;
      const otherEnd = other.startTime + other.duration;

      // Check if they overlap
      if (
        (currentStart >= otherStart && currentStart < otherEnd) ||
        (currentEnd > otherStart && currentEnd <= otherEnd) ||
        (currentStart <= otherStart && currentEnd >= otherEnd)
      ) {
        overlapping.push(i);
      }
    }

    // Find the lowest available track index
    const usedTracks = new Set<number>();
    for (const idx of overlapping) {
      const trackIdx = this.getAudioTrackIndex(allAudio[idx]!);
      usedTracks.add(trackIdx);
    }

    // Find first available track
    let trackIndex = 0;
    while (usedTracks.has(trackIndex)) {
      trackIndex++;
    }

    return trackIndex;
  }


  protected percentFor(time: number): number {
    const duration = this.duration();
    if (!duration) {
      return 0;
    }
    return (this.clamp(time, 0, duration) / duration) * 100;
  }

  protected percentSpan(start: number, end: number): number {
    return Math.max(this.percentFor(end) - this.percentFor(start), 0);
  }

  protected onTimelinePointerDown(event: PointerEvent): void {
    if (!this.sourceLoaded()) {
      return;
    }
    const target = event.currentTarget as HTMLElement;
    const isPlayheadHandle = (event.target as HTMLElement).closest('.timeline__playhead');
    const time = this.timelineTimeFromEvent(event, target);
    if (event.shiftKey) {
      this.timelineDrag = { pointerId: event.pointerId, anchor: time, mode: 'selection' };
      this.timelineSelection.set({ start: time, end: time });
    } else {
      this.timelineDrag = { pointerId: event.pointerId, anchor: time, mode: 'playhead' };
      this.previewTime.set(time); // Set preview time for smooth playhead movement
      this.jumpTo(time); // Seek immediately on click
      if (!isPlayheadHandle) {
        this.timelineSelection.set(null);
      }
    }
    target.setPointerCapture(event.pointerId);
  }

  protected onTimelinePointerMove(event: PointerEvent): void {
    if (!this.timelineDrag) {
      return;
    }
    const target = event.currentTarget as HTMLElement;
    const time = this.timelineTimeFromEvent(event, target);
    if (this.timelineDrag.mode === 'selection') {
      const start = Math.min(this.timelineDrag.anchor, time);
      const end = Math.max(this.timelineDrag.anchor, time);
      this.timelineSelection.set({ start, end });
    } else {
      // Update preview time for smooth playhead movement (don't seek video during drag)
      this.previewTime.set(time);
    }
  }

  protected onTimelinePointerUp(event: PointerEvent): void {
    if (!this.timelineDrag) {
      return;
    }
    const target = event.currentTarget as HTMLElement;
    const drag = this.timelineDrag;
    target.releasePointerCapture(drag.pointerId);
    const selection = this.timelineSelection();
    
    // If we were dragging the playhead, seek to the final position
    if (drag.mode === 'playhead' && this.previewTime() !== null) {
      this.jumpTo(this.previewTime()!);
    }
    
    this.timelineDrag = null;
    this.previewTime.set(null);

    if (drag.mode === 'selection' && selection) {
      if (this.timelineMode() === 'keep') {
        const result = this.timelineService.addSegment(selection.start, selection.end);
        if (!result.success && result.error) {
          this.errorMessage.set(result.error);
        } else {
          // Update segment selection to the added segment
          this.timelineService.setSegmentSelection(selection.start, selection.end);
          // Adjust audio for the new segment (which creates cuts around it)
          this.adjustAudioForCuts();
        }
      } else {
        const result = this.timelineService.addCut(selection.start, selection.end);
        if (!result.success && result.error) {
          this.errorMessage.set(result.error);
        } else {
          // Update cut selection to the added cut
          this.timelineService.setCutSelection(selection.start, selection.end);
          // Adjust audio for the new cut
          this.adjustAudioForCuts();
        }
      }
    }
    this.timelineSelection.set(null);
  }

  protected onTimelinePointerLeave(): void {
    if (!this.timelineDrag) {
      this.timelineSelection.set(null);
    }
  }

  protected openOverlayForm(type: 'text' | 'image' | 'shape'): void {
    this.overlayFormType.set(type);
    this.showOverlayForm.set(true);
    this.overlaySelection.set(null);
  }

  protected closeOverlayForm(): void {
    this.showOverlayForm.set(false);
    this.overlaySelection.set(null);
  }

  protected addTextOverlayFromForm(): void {
    if (!this.overlayFormContainer?.nativeElement) {
      return;
    }
    const container = this.overlayFormContainer.nativeElement;
    const textInput = container.querySelector<HTMLInputElement>('#textInput');
    const startInput = container.querySelector<HTMLInputElement>('#textStart');
    const endInput = container.querySelector<HTMLInputElement>('#textEnd');
    const xInput = container.querySelector<HTMLInputElement>('#textX');
    const yInput = container.querySelector<HTMLInputElement>('#textY');
    const fontSizeInput = container.querySelector<HTMLInputElement>('#textFontSize');
    const bgTransparentCheckbox = container.querySelector<HTMLInputElement>('#textBgTransparent');
    const fontColorInput = container.querySelector<HTMLInputElement>('#textFontColor');
    const bgColorInput = container.querySelector<HTMLInputElement>('#textBgColor');
    const opacityInput = container.querySelector<HTMLInputElement>('#textOpacity');

    if (!textInput || !startInput || !endInput || !xInput || !yInput || !fontSizeInput || !fontColorInput || !bgColorInput || !opacityInput) {
      return;
    }

    const text = textInput.value.trim();
    const start = Number(startInput.value) || 0;
    const end = Number(endInput.value) || 0;
    const x = Number(xInput.value) || 10;
    const y = Number(yInput.value) || 10;
    const fontSize = Number(fontSizeInput.value) || 24;
    const fontColor = fontColorInput.value || '#FFFFFF';
    const backgroundColor = bgTransparentCheckbox?.checked ? 'transparent' : (bgColorInput.value || '#000000');
    const opacity = Number(opacityInput.value) || 1;

    this.addTextOverlay(text, start, end, x, y, fontSize, fontColor, backgroundColor, opacity);
  }

  protected addImageOverlayFromForm(): void {
    if (!this.overlayFormContainer?.nativeElement) {
      return;
    }
    const container = this.overlayFormContainer.nativeElement;
    const imageUrlInput = container.querySelector<HTMLInputElement>('#imageUrl');
    const startInput = container.querySelector<HTMLInputElement>('#imageStart');
    const endInput = container.querySelector<HTMLInputElement>('#imageEnd');
    const xInput = container.querySelector<HTMLInputElement>('#imageX');
    const yInput = container.querySelector<HTMLInputElement>('#imageY');
    const widthInput = container.querySelector<HTMLInputElement>('#imageWidth');
    const heightInput = container.querySelector<HTMLInputElement>('#imageHeight');
    const opacityInput = container.querySelector<HTMLInputElement>('#imageOpacity');

    if (!imageUrlInput || !startInput || !endInput || !xInput || !yInput || !widthInput || !heightInput || !opacityInput) {
      return;
    }

    const imageUrl = imageUrlInput.value.trim();
    const start = Number(startInput.value) || 0;
    const end = Number(endInput.value) || 0;
    const x = Number(xInput.value) || 10;
    const y = Number(yInput.value) || 10;
    const width = Number(widthInput.value) || 20;
    const height = Number(heightInput.value) || 20;
    const opacity = Number(opacityInput.value) || 1;

    this.addImageOverlay(imageUrl, start, end, x, y, width, height, opacity);
    
    // Update the x/y inputs to reflect the overlay position (will be updated when dragged)
    setTimeout(() => {
      const overlay = this.overlays().find(o => o.type === 'image' && o.start === start);
      if (overlay) {
        xInput.value = overlay.x.toString();
        yInput.value = overlay.y.toString();
      }
    }, 0);
  }

  protected addShapeOverlayFromForm(): void {
    if (!this.overlayFormContainer?.nativeElement) {
      return;
    }
    const container = this.overlayFormContainer.nativeElement;
    const startInput = container.querySelector<HTMLInputElement>('#overlayStart');
    const endInput = container.querySelector<HTMLInputElement>('#overlayEnd');
    const xInput = container.querySelector<HTMLInputElement>('#overlayX');
    const yInput = container.querySelector<HTMLInputElement>('#overlayY');
    const widthInput = container.querySelector<HTMLInputElement>('#shapeWidth');
    const heightInput = container.querySelector<HTMLInputElement>('#shapeHeight');
    const colorInput = container.querySelector<HTMLInputElement>('#shapeColor');
    const strokeWidthInput = container.querySelector<HTMLInputElement>('#shapeStrokeWidth');
    const fillInput = container.querySelector<HTMLInputElement>('#shapeFill');
    const opacityInput = container.querySelector<HTMLInputElement>('#shapeOpacity');

    if (!startInput || !endInput || !xInput || !yInput || !widthInput || !heightInput || !colorInput || !strokeWidthInput || !fillInput || !opacityInput) {
      return;
    }

    const start = Number(startInput.value) || 0;
    const end = Number(endInput.value) || 0;
    const x = Number(xInput.value) || 10;
    const y = Number(yInput.value) || 10;
    const widthPercent = Number(widthInput.value) || 20;
    const heightPercent = Number(heightInput.value) || 20;
    const color = colorInput.value || '#FF0000';
    const strokeWidth = Number(strokeWidthInput.value) || 3;
    const fill = fillInput.checked;
    const opacity = Number(opacityInput.value) || 1;

    this.addShapeOverlay('rectangle', start, end, x, y, widthPercent, heightPercent, color, strokeWidth, fill, opacity);
  }

  protected removeOverlay(id: number): void {
    this.overlayService.deleteOverlay(id);
  }

  protected focusOverlay(overlay: Overlay, event?: Event): void {
    event?.stopPropagation();
    this.overlayService.selectOverlay(overlay);
    this.jumpTo(overlay.start);
  }

  protected getOverlayText(overlay: Overlay): string {
    if (overlay.type === 'text') {
      return overlay.text;
    }
    return '';
  }

  protected getOverlayImageUrl(overlay: Overlay): string {
    if (overlay.type === 'image') {
      return overlay.imageUrl;
    }
    return '';
  }

  protected getShapeOverlayColor(overlay: Overlay): string {
    return overlay.type === 'shape' ? (overlay.color || '#FF0000') : '#FF0000';
  }

  protected getShapeOverlayStrokeWidth(overlay: Overlay): number {
    return overlay.type === 'shape' ? (overlay.strokeWidth || 3) : 3;
  }

  protected getShapeOverlayFill(overlay: Overlay): boolean {
    return overlay.type === 'shape' ? (overlay.fill || false) : false;
  }

  protected getTextOverlayFontSize(overlay: Overlay): number {
    return overlay.type === 'text' ? (overlay.fontSize || 24) : 24;
  }

  protected getTextOverlayFontColor(overlay: Overlay): string {
    return overlay.type === 'text' ? (overlay.fontColor || '#FFFFFF') : '#FFFFFF';
  }

  protected getTextOverlayBgColor(overlay: Overlay): string {
    return overlay.type === 'text' ? (overlay.backgroundColor || 'transparent') : 'transparent';
  }

  protected getImageOverlayWidth(overlay: Overlay): number {
    return overlay.type === 'image' ? (overlay.width || 20) : 20;
  }

  protected getImageOverlayHeight(overlay: Overlay): number {
    return overlay.type === 'image' ? (overlay.height || 20) : 20;
  }

  protected getOverlayTitle(overlay: Overlay): string {
    if (overlay.type === 'text') return `Text: ${overlay.text}`;
    if (overlay.type === 'image') return 'Image Overlay';
    if (overlay.type === 'shape') return 'Rectangle Shape';
    return 'Overlay';
  }

  /**
   * TrackBy function for cuts - uses id for stable tracking
   */
  protected trackCutBy(index: number, cut: TimelineCut): number {
    return cut.id;
  }

  /**
   * TrackBy function for segments - uses id for stable tracking
   */
  protected trackSegmentBy(index: number, segment: TimelineSegment): number {
    return segment.id;
  }

  protected getShapeOverlayType(overlay: Overlay): 'rectangle' | null {
    return overlay.type === 'shape' ? overlay.shapeType : null;
  }

  protected getActiveOverlays(): Overlay[] {
    const currentTime = this.currentTime();
    return this.overlays().filter(
      overlay => currentTime >= overlay.start && currentTime <= overlay.end
    );
  }

  /**
   * Convert overlay position (0-100% relative to video) to container position (0-100% relative to container)
   */
  protected getOverlayLeftInContainer(overlay: Overlay): number {
    const bounds = this.getActualVideoBounds();
    if (!bounds) return overlay.x;
    
    const container = this.playerContainer?.nativeElement;
    if (!container) return overlay.x;
    
    const containerRect = container.getBoundingClientRect();
    // Convert video percentage to container percentage
    return ((bounds.x + (overlay.x / 100) * bounds.width) / containerRect.width) * 100;
  }

  protected getOverlayTopInContainer(overlay: Overlay): number {
    const bounds = this.getActualVideoBounds();
    if (!bounds) return overlay.y;
    
    const container = this.playerContainer?.nativeElement;
    if (!container) return overlay.y;
    
    const containerRect = container.getBoundingClientRect();
    // Convert video percentage to container percentage
    return ((bounds.y + (overlay.y / 100) * bounds.height) / containerRect.height) * 100;
  }

  protected getOverlayWidthInContainer(overlay: Overlay): number {
    if (overlay.type === 'text') return 0;
    
    const bounds = this.getActualVideoBounds();
    if (!bounds) return 0;
    
    const container = this.playerContainer?.nativeElement;
    if (!container) return 0;
    
    // Get width in pixels from overlay
    const widthPixels = overlay.type === 'image' ? (overlay.width || 200) : (overlay.width || 200);
    
    // Convert pixels to container percentage
    // widthPixels is relative to video dimensions, we need to scale it to container
    const containerRect = container.getBoundingClientRect();
    const scaleFactor = bounds.width / (this.videoElement?.nativeElement?.videoWidth || 1920);
    const widthInContainer = widthPixels * scaleFactor;
    
    return (widthInContainer / containerRect.width) * 100;
  }

  protected getOverlayHeightInContainer(overlay: Overlay): number {
    if (overlay.type === 'text') return 0;
    
    const bounds = this.getActualVideoBounds();
    if (!bounds) return 0;
    
    const container = this.playerContainer?.nativeElement;
    if (!container) return 0;
    
    // Get height in pixels from overlay
    const heightPixels = overlay.type === 'image' ? (overlay.height || 200) : (overlay.height || 200);
    
    // Convert pixels to container percentage
    // heightPixels is relative to video dimensions, we need to scale it to container
    const containerRect = container.getBoundingClientRect();
    const scaleFactor = bounds.height / (this.videoElement?.nativeElement?.videoHeight || 1080);
    const heightInContainer = heightPixels * scaleFactor;
    
    return (heightInContainer / containerRect.height) * 100;
  }

  protected startDragOverlay(overlay: Overlay, event: PointerEvent): void {
    event.preventDefault();
    event.stopPropagation();
    const videoBounds = this.getActualVideoBounds();
    const container = this.playerContainer?.nativeElement;
    if (!videoBounds || !container) return;
    
    const containerRect = container.getBoundingClientRect();
    // Calculate position relative to actual video, not container
    const x = ((event.clientX - containerRect.left - videoBounds.x) / videoBounds.width) * 100;
    const y = ((event.clientY - containerRect.top - videoBounds.y) / videoBounds.height) * 100;
    
    this.draggingOverlay.set({
      overlay,
      startX: x,
      startY: y,
      offsetX: overlay.x,
      offsetY: overlay.y
    });
    
    // Don't set pointer capture - let the movement shield handle it
  }

  protected dragOverlay(event: PointerEvent): void {
    const drag = this.draggingOverlay();
    if (!drag) return;
    
    const videoBounds = this.getActualVideoBounds();
    const container = this.playerContainer?.nativeElement;
    if (!videoBounds || !container) return;
    
    const containerRect = container.getBoundingClientRect();
    // Calculate position relative to actual video, not container
    const x = ((event.clientX - containerRect.left - videoBounds.x) / videoBounds.width) * 100;
    const y = ((event.clientY - containerRect.top - videoBounds.y) / videoBounds.height) * 100;
    
    const deltaX = x - drag.startX;
    const deltaY = y - drag.startY;
    
    const newX = this.clamp(drag.offsetX + deltaX, 0, 100);
    const newY = this.clamp(drag.offsetY + deltaY, 0, 100);
    
    // Update overlay position
    const updatedOverlays = this.overlays().map(o => 
      o.id === drag.overlay.id 
        ? { ...o, x: newX, y: newY }
        : o
    );
    this.overlays.set(updatedOverlays);
    
    // Update form inputs if form is open
    if (this.overlayFormContainer?.nativeElement && this.showOverlayForm()) {
      const formContainer = this.overlayFormContainer.nativeElement;
      const xInput = formContainer.querySelector<HTMLInputElement>('#textX') || formContainer.querySelector<HTMLInputElement>('#imageX');
      const yInput = formContainer.querySelector<HTMLInputElement>('#textY') || formContainer.querySelector<HTMLInputElement>('#imageY');
      if (xInput) xInput.value = newX.toString();
      if (yInput) yInput.value = newY.toString();
    }
  }

  protected stopDragOverlay(): void {
    this.draggingOverlay.set(null);
  }

  protected startResizeOverlay(overlay: Overlay, event: PointerEvent, corner: 'se' | 'sw' | 'ne' | 'nw'): void {
    event.preventDefault();
    event.stopPropagation();
    const container = this.playerContainer?.nativeElement;
    if (!container) return;
    
    const startX = event.clientX;
    const startY = event.clientY;
    
    if (overlay.type === 'text') {
      // For text, track starting font size
      this.resizingOverlay.set({
        overlay,
        startWidth: overlay.fontSize || 24,
        startHeight: overlay.fontSize || 24,
        startX,
        startY,
        corner
      });
    } else {
      // For images and shapes, track width/height (in pixels)
      this.resizingOverlay.set({
        overlay,
        startWidth: overlay.width || 200, // pixels
        startHeight: overlay.height || 200, // pixels
        startX,
        startY,
        corner
      });
    }
    
    // Don't set pointer capture - let the movement shield handle it
  }

  protected resizeOverlay(event: PointerEvent): void {
    const resize = this.resizingOverlay();
    if (!resize) return;
    
    const videoBounds = this.getActualVideoBounds();
    if (!videoBounds) return;
    
    // Calculate delta based on actual video bounds
    const deltaX = ((event.clientX - resize.startX) / videoBounds.width) * 100;
    const deltaY = ((event.clientY - resize.startY) / videoBounds.height) * 100;
    
    // For text overlays, adjust fontSize based on distance from starting point
    if (resize.overlay.type === 'text') {
      // Calculate diagonal distance (Euclidean distance)
      const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
      
      // Determine direction based on corner and movement
      let direction = 1; // 1 = increase, -1 = decrease
      
      if (resize.corner === 'se') {
        // SE: right+down = increase, left+up = decrease
        direction = (deltaX + deltaY >= 0) ? 1 : -1;
      } else if (resize.corner === 'sw') {
        // SW: left+down = increase, right+up = decrease
        direction = (-deltaX + deltaY >= 0) ? 1 : -1;
      } else if (resize.corner === 'ne') {
        // NE: right+up = increase, left+down = decrease
        direction = (deltaX - deltaY >= 0) ? 1 : -1;
      } else if (resize.corner === 'nw') {
        // NW: left+up = increase, right+down = decrease
        direction = (-deltaX - deltaY >= 0) ? 1 : -1;
      }
      
      // Scale fontSize: 1% screen distance = 2px font size
      const fontSizeChange = distance * direction * 2;
      const newFontSize = Math.max(12, Math.min(200, resize.startWidth + fontSizeChange));
      
      // Update text overlay (position stays the same for now - SE behavior)
      const updatedOverlays = this.overlays().map(o => 
        o.id === resize.overlay.id && o.type === 'text'
          ? { ...o, fontSize: newFontSize }
          : o
      );
      this.overlays.set(updatedOverlays);
      
      // Update form input if form is open
      if (this.overlayFormContainer?.nativeElement && this.showOverlayForm()) {
        const formContainer = this.overlayFormContainer.nativeElement;
        const fontSizeInput = formContainer.querySelector<HTMLInputElement>('#textFontSize');
        if (fontSizeInput) fontSizeInput.value = Math.round(newFontSize).toString();
      }
      return;
    }
    
    // For images and shapes, adjust width/height (in pixels)
    // Get video dimensions to convert percentage deltas to pixel deltas
    const video = this.videoElement?.nativeElement;
    const videoWidth = video?.videoWidth || 1920;
    const videoHeight = video?.videoHeight || 1080;
    
    // Convert percentage delta to pixel delta
    const deltaXPixels = (deltaX / 100) * videoWidth;
    const deltaYPixels = (deltaY / 100) * videoHeight;
    
    let newWidth = resize.startWidth;
    let newHeight = resize.startHeight;
    let newX = resize.overlay.x;
    let newY = resize.overlay.y;
    
    // Adjust based on corner
    if (resize.corner === 'se') {
      // Southeast: adjust width and height, keep x,y
      newWidth = this.clamp(resize.startWidth + deltaXPixels, 1, videoWidth);
      newHeight = this.clamp(resize.startHeight + deltaYPixels, 1, videoHeight);
    } else if (resize.corner === 'sw') {
      // Southwest: adjust width (negative), height, and x
      newWidth = this.clamp(resize.startWidth - deltaXPixels, 1, videoWidth);
      newHeight = this.clamp(resize.startHeight + deltaYPixels, 1, videoHeight);
      newX = this.clamp(resize.overlay.x + deltaX, 0, 100);
    } else if (resize.corner === 'ne') {
      // Northeast: adjust width, height (negative), and y
      newWidth = this.clamp(resize.startWidth + deltaXPixels, 1, videoWidth);
      newHeight = this.clamp(resize.startHeight - deltaYPixels, 1, videoHeight);
      newY = this.clamp(resize.overlay.y + deltaY, 0, 100);
    } else if (resize.corner === 'nw') {
      // Northwest: adjust width (negative), height (negative), x, and y
      newWidth = this.clamp(resize.startWidth - deltaXPixels, 1, videoWidth);
      newHeight = this.clamp(resize.startHeight - deltaYPixels, 1, videoHeight);
      newX = this.clamp(resize.overlay.x + deltaX, 0, 100);
      newY = this.clamp(resize.overlay.y + deltaY, 0, 100);
    }
    
    // Update overlay
    const updatedOverlays = this.overlays().map(o => 
      o.id === resize.overlay.id && (o.type === 'image' || o.type === 'shape')
        ? { ...o, width: newWidth, height: newHeight, x: newX, y: newY }
        : o
    );
    this.overlays.set(updatedOverlays);
    
    // Update form inputs if form is open (convert pixels back to percentage for display)
    if (this.overlayFormContainer?.nativeElement && this.showOverlayForm()) {
      const formContainer = this.overlayFormContainer.nativeElement;
      const xInput = formContainer.querySelector<HTMLInputElement>('#imageX, #overlayX');
      const yInput = formContainer.querySelector<HTMLInputElement>('#imageY, #overlayY');
      const widthInput = formContainer.querySelector<HTMLInputElement>('#imageWidth, #shapeWidth');
      const heightInput = formContainer.querySelector<HTMLInputElement>('#imageHeight, #shapeHeight');
      
      // Convert pixels back to percentage for form display
      const widthPercent = Math.round((newWidth / videoWidth) * 100);
      const heightPercent = Math.round((newHeight / videoHeight) * 100);
      
      if (xInput) xInput.value = Math.round(newX).toString();
      if (yInput) yInput.value = Math.round(newY).toString();
      if (widthInput) widthInput.value = widthPercent.toString();
      if (heightInput) heightInput.value = heightPercent.toString();
    }
  }

  protected stopResizeOverlay(): void {
    this.resizingOverlay.set(null);
  }

  protected async renderViaBackend(): Promise<void> {
    if (!this.canRender()) {
      this.errorMessage.set('Load a video and set trim points before rendering.');
      return;
    }

    const allSources = this.sources();
    if (allSources.length === 0) {
      this.errorMessage.set('Add at least one source before rendering.');
      return;
    }

    this.renderBusy.set(true);
    this.renderResult.set(null);
    this.errorMessage.set('');

    try {
      // Collect all local files that need to be uploaded
      const filesToUpload = new Map<string, File>();
      const urlMapping = new Map<string, string>(); // Maps local URL to server URL

      // Collect source files
      for (const source of allSources) {
        const file = this.localFiles.get(source.url);
        if (file) {
          filesToUpload.set(source.url, file);
        }
      }

      // Collect audio files
      for (const audio of this.audioSources()) {
        const file = this.localFiles.get(audio.url);
        if (file) {
          filesToUpload.set(audio.url, file);
        }
      }

      // Collect overlay image files
      for (const overlay of this.overlays()) {
        if (overlay.type === 'image') {
          const file = this.localFiles.get(overlay.imageUrl);
          if (file) {
            filesToUpload.set(overlay.imageUrl, file);
          }
        }
      }

      // Upload all local files
      this.errorMessage.set('Uploading files...');
      for (const [localUrl, file] of filesToUpload.entries()) {
        const serverUrl = await this.uploadFile(file);
        urlMapping.set(localUrl, serverUrl);
      }

      // Replace local URLs with server URLs
      const sourcesWithServerUrls = allSources.map(s => ({
        ...s,
        url: urlMapping.get(s.url) || s.url
      }));

      const audioWithServerUrls = this.audioSources().map(a => ({
        ...a,
        url: urlMapping.get(a.url) || a.url
      }));

      const overlaysWithServerUrls = this.overlays().map(o => {
        if (o.type === 'image' && urlMapping.has(o.imageUrl)) {
          return { ...o, imageUrl: urlMapping.get(o.imageUrl)! };
        }
        return o;
      });

      // Use effective cuts (converts segments to cuts if in keep mode)
      const effectiveCuts = this.timelineService.getEffectiveCuts()();
      
      this.errorMessage.set('Rendering...');
      this.renderService.render(
        sourcesWithServerUrls,
        this.trimStart(),
        this.trimEnd(),
        effectiveCuts,
        overlaysWithServerUrls,
        audioWithServerUrls,
        this.audioMixMode()
      ).subscribe({
        next: async response => {
          this.renderResult.set(response);
          this.renderBusy.set(false);
          
          // Display warning if present
          if (response.warning) {
            this.errorMessage.set(`⚠️ Warning: ${response.warning}`);
          }

          // Clean up uploaded files after render completes
          await this.cleanupUploadedFiles(urlMapping.values());
        },
        error: async err => {
          const message =
            err?.error?.error ||
            err?.message ||
            'Render request failed. Ensure the backend server is running.';
          this.errorMessage.set(message);
          this.renderBusy.set(false);
          
          // Clean up uploaded files even on error
          await this.cleanupUploadedFiles(urlMapping.values());
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to upload files';
      this.errorMessage.set(message);
      this.renderBusy.set(false);
    }
  }

  /**
   * Clean up uploaded files from server
   */
  private async cleanupUploadedFiles(serverUrls: Iterable<string>): Promise<void> {
    const urls = Array.from(serverUrls);
    if (urls.length === 0) return;

    try {
      // Extract filenames from URLs
      const filenames = urls.map(url => {
        const match = url.match(/\/uploads\/([^\/]+)$/);
        return match ? match[1] : null;
      }).filter((f): f is string => f !== null);

      if (filenames.length > 0) {
        await firstValueFrom(
          this.http.post(`${this.backendHost}/api/cleanup`, { filenames })
        );
      }
    } catch (error) {
      console.warn('Failed to cleanup uploaded files:', error);
      // Don't show error to user, cleanup failure is not critical
    }
  }

  protected renderDownloadUrl(): string | null {
    const result = this.renderResult();
    if (!result) {
      return null;
    }
    return this.renderService.getDownloadUrl(result.outputFile);
  }

  // ========== Audio Management Methods ==========

  /**
   * Add an audio source
   */
  protected async addAudioSource(): Promise<void> {
    const audioUrlInput = document.getElementById('audioUrl') as HTMLInputElement;
    const audioStartInput = document.getElementById('audioStart') as HTMLInputElement;

    if (!audioUrlInput || !audioStartInput) {
      this.errorMessage.set('Audio form inputs not found');
      return;
    }

    const url = audioUrlInput.value.trim();
    const startTime = parseFloat(audioStartInput.value) || this.currentTime();
    const volume = 1; // Default volume, can be adjusted after adding

    if (!url) {
      this.errorMessage.set('Audio URL is required');
      return;
    }

    // Get audio duration
    let duration = 0;
    try {
      duration = await this.getAudioDuration(url);
      if (!duration || isNaN(duration) || !isFinite(duration) || duration <= 0) {
        throw new Error(`Invalid duration (${duration}) for audio: ${url}`);
      }
    } catch (error) {
      this.errorMessage.set(`Failed to load audio: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return;
    }

    // Ensure audio doesn't extend beyond video duration
    const maxDuration = this.duration();
    const adjustedDuration = Math.min(duration, maxDuration - startTime);
    
    if (adjustedDuration <= 0) {
      this.errorMessage.set('Audio would be completely outside video duration');
      return;
    }

    const result = this.audioService.addAudioSource(url, startTime, adjustedDuration, volume, duration);
    
    if (result.success) {
      // If there are existing cuts, adjust the newly added audio for them
      const cuts = this.cutsRaw();
      if (cuts.length > 0) {
        this.adjustAudioForCuts();
      } else {
        this.initializeAudioPlayback();
      }
      
      this.closeAudioForm();
      this.errorMessage.set('');
    } else {
      this.errorMessage.set(result.error || 'Failed to add audio source');
    }
  }

  /**
   * Remove an audio source
   */
  protected removeAudioSource(id: number): void {
    this.audioService.removeAudioSource(id);
    this.cleanupAudioElement(id);
    this.initializeAudioPlayback();
  }

  /**
   * Open audio form
   */
  protected openAudioForm(): void {
    this.showAudioForm.set(true);
    this.errorMessage.set('');
  }

  /**
   * Close audio form
   */
  protected closeAudioForm(): void {
    this.showAudioForm.set(false);
  }

  /**
   * Open cut/segment form
   */
  protected openCutForm(): void {
    this.showCutForm.set(true);
    this.errorMessage.set('');
  }

  /**
   * Close cut/segment form
   */
  protected closeCutForm(): void {
    this.showCutForm.set(false);
  }

  /**
   * Update audio volume
   */
  protected updateAudioVolume(id: number, volume: number): void {
    const result = this.audioService.setAudioVolume(id, volume);
    if (!result.success) {
      this.errorMessage.set(result.error || 'Failed to update audio volume');
    } else {
      const audioEl = this.audioElements.get(id);
      if (audioEl) {
        audioEl.volume = volume * this.masterVolume();
      }
    }
  }

  /**
   * Toggle mute for audio source
   */
  protected toggleAudioMute(id: number): void {
    this.audioService.toggleMute(id);
    this.initializeAudioPlayback();
  }

  /**
   * Update master volume
   */
  protected updateMasterVolume(volume: number): void {
    const result = this.audioService.setMasterVolume(volume);
    if (!result.success) {
      this.errorMessage.set(result.error || 'Failed to update master volume');
    } else {
      // Update all audio elements
      this.audioElements.forEach((audioEl, id) => {
        const audio = this.audioSources().find(a => a.id === id);
        if (audio) {
          audioEl.volume = audio.volume * volume;
        }
      });
    }
  }

  /**
   * Set audio mix mode
   */
  protected setAudioMixMode(mode: 'mix' | 'replace'): void {
    this.audioService.setAudioMixMode(mode);
  }

  /**
   * Handle audio timeline pointer down (for dragging)
   */
  protected onAudioTimelinePointerDown(event: PointerEvent, audio: AudioSource): void {
    event.preventDefault();
    event.stopPropagation();
    
    const timeline = (event.currentTarget as HTMLElement).closest('.audio-timeline');
    if (!timeline) return;

    const rect = timeline.getBoundingClientRect();
    const x = event.clientX - rect.left;
    
    // Calculate the offset from the start of the audio clip
    const percent = (x / rect.width) * 100;
    const clickTime = (percent / 100) * this.duration();
    const offsetFromStart = clickTime - audio.startTime;

    // Store original values and offset
    this.audioTimelineDrag = {
      audioId: audio.id,
      startX: x,
      startTime: audio.startTime,
      originalDuration: audio.duration,
      offsetFromStart: Math.max(0, Math.min(offsetFromStart, audio.duration))
    } as AudioTimelineDrag & { originalDuration: number; offsetFromStart: number };

    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  /**
   * Handle audio timeline pointer move (for dragging)
   */
  protected onAudioTimelinePointerMove(event: PointerEvent): void {
    if (!this.audioTimelineDrag) return;

    const timeline = (event.currentTarget as HTMLElement).closest('.audio-timeline');
    if (!timeline) return;

    const rect = timeline.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const percent = (x / rect.width) * 100;
    const clickTime = (percent / 100) * this.duration();
    
    // Calculate new start time based on drag offset
    const dragState = this.audioTimelineDrag as AudioTimelineDrag & { 
      originalDuration: number; 
      offsetFromStart: number;
    };
    
    // Calculate new start time: where we clicked minus the offset
    let newStartTime = clickTime - dragState.offsetFromStart;
    
    // Constrain: audio cannot extend beyond video duration
    // Maximum start time is video duration minus original audio duration
    const maxStartTime = Math.max(0, this.duration() - dragState.originalDuration);
    newStartTime = Math.max(0, Math.min(newStartTime, maxStartTime));

    // Update position - always use original duration during drag
    // The duration will only be adjusted on drop if it extends beyond video
    const audio = this.audioSources().find(a => a.id === this.audioTimelineDrag!.audioId);
    if (!audio) return;

    // During drag, always preserve original duration for visual consistency
    // Only update the start time - this prevents the shrinking issue
    const updates: Partial<AudioSource> = { 
      startTime: newStartTime,
      duration: dragState.originalDuration // Always use original during drag
    };

    // Check for overlaps with other audio (excluding current)
    const otherAudio = this.audioSources().filter(a => a.id !== this.audioTimelineDrag!.audioId);
    const wouldOverlap = otherAudio.some(a => {
      const aEnd = a.startTime + a.duration;
      const newEnd = newStartTime + dragState.originalDuration;
      return (
        (newStartTime >= a.startTime && newStartTime < aEnd) ||
        (newEnd > a.startTime && newEnd <= aEnd) ||
        (newStartTime <= a.startTime && newEnd >= aEnd)
      );
    });

    if (!wouldOverlap) {
      this.audioService.updateAudioSource(this.audioTimelineDrag.audioId, updates);
    }
  }

  /**
   * Handle audio timeline pointer up (end dragging)
   */
  protected onAudioTimelinePointerUp(event: PointerEvent): void {
    if (this.audioTimelineDrag) {
      const dragState = this.audioTimelineDrag as AudioTimelineDrag & { 
        originalDuration: number; 
      };
      
      // Get current audio state
      const audio = this.audioSources().find(a => a.id === this.audioTimelineDrag!.audioId);
      
      if (audio) {
        // Check if audio extends beyond video duration and adjust if needed
        const endTime = audio.startTime + audio.duration;
        if (endTime > this.duration()) {
          // Adjust duration to fit within video
          const adjustedDuration = Math.max(0, this.duration() - audio.startTime);
          if (adjustedDuration > 0 && adjustedDuration !== audio.duration) {
            this.audioService.updateAudioSource(this.audioTimelineDrag.audioId, { 
              duration: adjustedDuration 
            });
          }
        } else if (audio.duration !== dragState.originalDuration) {
          // Restore original duration if it was shortened during drag
          this.audioService.updateAudioSource(this.audioTimelineDrag.audioId, { 
            duration: dragState.originalDuration 
          });
        }
      }
      
      (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
      // Reinitialize playback after drag is complete
      this.initializeAudioPlayback();
      this.audioTimelineDrag = null;
    }
  }

  /**
   * Start editing audio trim points
   */
  protected startEditingAudio(id: number): void {
    this.editingAudioId.set(id);
  }

  /**
   * Cancel editing audio
   */
  protected cancelEditingAudio(): void {
    this.editingAudioId.set(null);
  }

  /**
   * Update audio trim points
   */
  protected updateAudioTrim(id: number, trimStart: number, trimEnd: number): void {
    const audio = this.audioSources().find(a => a.id === id);
    if (!audio) return;

    // Validate trim points
    if (trimStart < 0 || trimStart >= trimEnd || trimEnd > audio.originalDuration) {
      this.errorMessage.set('Invalid trim points');
      return;
    }

    // Calculate new duration based on trim
    const trimmedDuration = trimEnd - trimStart;
    
    // Check if the trimmed audio would still fit in the video timeline
    const maxDuration = this.duration();
    const endTime = audio.startTime + trimmedDuration;
    if (endTime > maxDuration) {
      this.errorMessage.set('Trimmed audio would extend beyond video duration');
      return;
    }

    // Update audio source with new trim points and duration
    this.audioService.updateAudioSource(id, {
      audioTrimStart: trimStart,
      audioTrimEnd: trimEnd,
      duration: trimmedDuration
    });

    // Reinitialize playback to apply changes
    this.initializeAudioPlayback();
    this.cancelEditingAudio();
    this.errorMessage.set('');
  }

  // File upload and drag-and-drop methods
  /**
   * Create object URL for local file preview (doesn't upload to server)
   */
  protected createLocalFileUrl(file: File): string {
    const objectUrl = URL.createObjectURL(file);
    // Store file and object URL for later cleanup
    this.localFiles.set(objectUrl, file);
    this.objectUrls.set(objectUrl, objectUrl);
    return objectUrl;
  }

  /**
   * Upload a file to the server (only called during render)
   */
  private async uploadFile(file: File): Promise<string> {
    const formData = new FormData();
    formData.append('file', file);
    
    try {
      const response = await firstValueFrom(
        this.http.post<{ success: boolean; url: string; filename: string }>(
          `${this.backendHost}/api/upload`,
          formData
        )
      );
      
      if (!response || !response.success || !response.url) {
        throw new Error('Upload failed: Invalid response');
      }
      
      // Return full URL
      return `${this.backendHost}${response.url}`;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Upload failed';
      this.errorMessage.set(`Failed to upload file: ${message}`);
      throw error;
    }
  }

  /**
   * Handle source file selection
   */
  protected async onSourceFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    
    await this.handleSourceFile(file);
    // Reset input
    input.value = '';
  }

  /**
   * Handle source file (create object URL for preview, don't upload yet)
   */
  protected async handleSourceFile(file: File): Promise<void> {
    this.loading.set(true);
    this.errorMessage.set('');
    
    try {
      // Create object URL for preview (doesn't upload to server)
      const objectUrl = this.createLocalFileUrl(file);
      this.sourceForm.controls.sourceUrl.setValue(objectUrl);
      
      // Get duration for video files
      if (file.type.startsWith('video/') || file.name.toLowerCase().endsWith('.mpd')) {
        const duration = await this.getVideoDuration(objectUrl);
        if (duration && duration > 0) {
          // Duration will be set when source is added
        }
      }
    } catch (error) {
      console.error('Failed to handle source file:', error);
      this.errorMessage.set('Failed to load file');
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * Handle source drag over
   */
  protected onSourceDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    // Only update signal if state would change (reduces change detection cycles)
    if (this.isValidSourceFile(event.dataTransfer) && !this.isDraggingSource()) {
      this.isDraggingSource.set(true);
    }
  }

  /**
   * Handle source drag leave
   */
  protected onSourceDragLeave(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    // Only update signal if state would change
    if (this.isDraggingSource()) {
      this.isDraggingSource.set(false);
    }
  }

  /**
   * Handle source drop
   */
  protected async onSourceDrop(event: DragEvent): Promise<void> {
    event.preventDefault();
    event.stopPropagation();
    this.isDraggingSource.set(false);
    
    const file = event.dataTransfer?.files[0];
    if (file && this.isValidSourceFile(event.dataTransfer)) {
      await this.handleSourceFile(file);
    }
  }

  /**
   * Check if dragged file is a valid source file
   */
  protected isValidSourceFile(dataTransfer: DataTransfer | null): boolean {
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
   * Handle audio file selection
   */
  protected async onAudioFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    
    await this.handleAudioFile(file);
    // Reset input
    input.value = '';
  }

  /**
   * Handle audio file (create object URL for preview, don't upload yet)
   */
  protected async handleAudioFile(file: File): Promise<void> {
    this.loading.set(true);
    this.errorMessage.set('');
    
    try {
      // Create object URL for preview (doesn't upload to server)
      const objectUrl = this.createLocalFileUrl(file);
      const audioUrlInput = document.getElementById('audioUrl') as HTMLInputElement;
      if (audioUrlInput) {
        audioUrlInput.value = objectUrl;
        this.audioUrlValue.set(objectUrl);
        // Update has-value class
        const wrapper = audioUrlInput.closest('.unified-input-wrapper');
        if (wrapper) {
          wrapper.classList.toggle('has-value', !!objectUrl);
        }
      }
    } catch (error) {
      console.error('Failed to handle audio file:', error);
      this.errorMessage.set('Failed to load file');
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * Handle audio drag over
   */
  protected onAudioDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    // Only update signal if state would change (reduces change detection cycles)
    if (this.isValidAudioFile(event.dataTransfer) && !this.isDraggingAudio()) {
      this.isDraggingAudio.set(true);
    }
  }

  /**
   * Handle audio drag leave
   */
  protected onAudioDragLeave(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    // Only update signal if state would change
    if (this.isDraggingAudio()) {
      this.isDraggingAudio.set(false);
    }
  }

  /**
   * Handle audio drop
   */
  protected async onAudioDrop(event: DragEvent): Promise<void> {
    event.preventDefault();
    event.stopPropagation();
    this.isDraggingAudio.set(false);
    
    const file = event.dataTransfer?.files[0];
    if (file && this.isValidAudioFile(event.dataTransfer)) {
      await this.handleAudioFile(file);
    }
  }

  /**
   * Check if dragged file is a valid audio file
   */
  protected isValidAudioFile(dataTransfer: DataTransfer | null): boolean {
    if (!dataTransfer) return false;
    
    const items = Array.from(dataTransfer.items);
    if (items.length === 0) return false;
    
    const item = items[0];
    if (item.kind !== 'file') return false;
    
    const file = item.getAsFile();
    if (!file) return false;
    
    const name = file.name.toLowerCase();
    const validExtensions = ['.mp3', '.wav', '.ogg', '.aac', '.m4a'];
    return validExtensions.some(ext => name.endsWith(ext));
  }

  /**
   * Handle image file selection
   */
  protected async onImageFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    
    await this.handleImageFile(file);
    // Reset input
    input.value = '';
  }

  /**
   * Handle image file (create object URL for preview, don't upload yet)
   */
  protected async handleImageFile(file: File): Promise<void> {
    this.loading.set(true);
    this.errorMessage.set('');
    
    try {
      // Create object URL for preview (doesn't upload to server)
      const objectUrl = this.createLocalFileUrl(file);
      const imageUrlInput = document.getElementById('imageUrl') as HTMLInputElement;
      if (imageUrlInput) {
        imageUrlInput.value = objectUrl;
        this.imageUrlValue.set(objectUrl);
        // Update has-value class
        const wrapper = imageUrlInput.closest('.unified-input-wrapper');
        if (wrapper) {
          wrapper.classList.toggle('has-value', !!objectUrl);
        }
      }
    } catch (error) {
      console.error('Failed to handle image file:', error);
      this.errorMessage.set('Failed to load file');
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * Handle image drag over
   */
  protected onImageDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    // Only update signal if state would change (reduces change detection cycles)
    if (this.isValidImageFile(event.dataTransfer) && !this.isDraggingImage()) {
      this.isDraggingImage.set(true);
    }
  }

  /**
   * Handle image drag leave
   */
  protected onImageDragLeave(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    // Only update signal if state would change
    if (this.isDraggingImage()) {
      this.isDraggingImage.set(false);
    }
  }

  /**
   * Handle image drop
   */
  protected async onImageDrop(event: DragEvent): Promise<void> {
    event.preventDefault();
    event.stopPropagation();
    this.isDraggingImage.set(false);
    
    const file = event.dataTransfer?.files[0];
    if (file && this.isValidImageFile(event.dataTransfer)) {
      await this.handleImageFile(file);
    }
  }

  /**
   * Check if dragged file is a valid image file
   */
  protected isValidImageFile(dataTransfer: DataTransfer | null): boolean {
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
   * Update has-value class on input wrapper
   */
  protected updateHasValueClass(event: Event): void {
    const input = event.target as HTMLInputElement;
    const wrapper = input.closest('.unified-input-wrapper');
    if (wrapper) {
      wrapper.classList.toggle('has-value', !!input.value);
      
      // Update signals for drag-hint visibility (signals trigger change detection automatically)
      if (input.id === 'audioUrl') {
        this.audioUrlValue.set(input.value);
      } else if (input.id === 'imageUrl') {
        this.imageUrlValue.set(input.value);
      }
    }
  }

  /**
   * Open file picker for source
   */
  protected openSourceFilePicker(event?: Event): void {
    // Prevent if clicking on the URL input itself
    if (event && (event.target as HTMLElement).tagName === 'INPUT') {
      return;
    }
    
    if (event) {
      event.preventDefault();
      event.stopPropagation();
      const wrapper = (event.target as HTMLElement).closest('.unified-input-wrapper');
      if (wrapper) {
        const fileInput = wrapper.querySelector('input[type="file"]') as HTMLInputElement;
        if (fileInput) {
          fileInput.click();
          return;
        }
      }
    }
    // Fallback: find by template reference
    const fileInput = document.querySelector('input[type="file"][accept*=".mp4"]') as HTMLInputElement;
    if (fileInput) {
      fileInput.click();
    }
  }

  /**
   * Open file picker for audio
   */
  protected openAudioFilePicker(event?: Event): void {
    // Prevent if clicking on the URL input itself
    if (event && (event.target as HTMLElement).tagName === 'INPUT') {
      return;
    }
    
    if (event) {
      event.preventDefault();
      event.stopPropagation();
      const wrapper = (event.target as HTMLElement).closest('.unified-input-wrapper');
      if (wrapper) {
        const fileInput = wrapper.querySelector('input[type="file"]') as HTMLInputElement;
        if (fileInput) {
          fileInput.click();
          return;
        }
      }
    }
    // Fallback: find by accept attribute
    const fileInput = document.querySelector('input[type="file"][accept*=".mp3"]') as HTMLInputElement;
    if (fileInput) {
      fileInput.click();
    }
  }

  /**
   * Open file picker for image overlay
   */
  protected openImageFilePicker(event?: Event): void {
    // Prevent if clicking on the URL input itself
    if (event && (event.target as HTMLElement).tagName === 'INPUT') {
      return;
    }
    
    if (event) {
      event.preventDefault();
      event.stopPropagation();
      const wrapper = (event.target as HTMLElement).closest('.unified-input-wrapper');
      if (wrapper) {
        const fileInput = wrapper.querySelector('input[type="file"]') as HTMLInputElement;
        if (fileInput) {
          fileInput.click();
          return;
        }
      }
    }
    // Fallback: find by accept attribute
    const fileInput = document.querySelector('input[type="file"][accept*=".jpg"]') as HTMLInputElement;
    if (fileInput) {
      fileInput.click();
    }
  }

  // Private methods
  /**
   * Get duration of a video by loading its metadata
   */
  private getVideoDuration(url: string): Promise<number> {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      
      const isMpd = url.toLowerCase().endsWith('.mpd');
      
      if (isMpd) {
        // Use dash.js for MPD files
        const player = dashjs.MediaPlayer().create();
        
        const timeout = setTimeout(() => {
          player.reset();
          reject(new Error('Timeout loading MPD metadata (10s)'));
        }, 10000); // 10 second timeout
        
        // Dash.js fires 'canPlay' when stream is ready
        const onCanPlay = (): void => {
          clearTimeout(timeout);
          const duration = video.duration;
          
          if (duration && !isNaN(duration) && isFinite(duration) && duration > 0) {
            player.reset();
            resolve(duration);
          } else {
            player.reset();
            reject(new Error(`Could not determine video duration from MPD (got ${duration})`));
          }
        };
        
        const onStreamInitialized = (): void => {
          // Sometimes duration is available after stream initialization
          if (video.duration && !isNaN(video.duration) && isFinite(video.duration) && video.duration > 0) {
            clearTimeout(timeout);
            player.reset();
            resolve(video.duration);
          }
        };
        
        const onError = (e: { error?: string }): void => {
          clearTimeout(timeout);
          player.reset();
          reject(new Error(`Failed to load MPD metadata: ${e.error || 'Unknown error'}`));
        };
        
        const onManifestLoaded = (e: { data?: { mediaPresentationDuration?: number } }): void => {
          // The manifest might contain duration info
          if (e && e.data && e.data.mediaPresentationDuration) {
            clearTimeout(timeout);
            player.reset();
            resolve(e.data.mediaPresentationDuration);
          }
        };
        
        // Listen to dash.js events
        player.on(dashjs.MediaPlayer.events.CAN_PLAY, onCanPlay);
        player.on(dashjs.MediaPlayer.events.STREAM_INITIALIZED, onStreamInitialized);
        player.on(dashjs.MediaPlayer.events.ERROR, onError);
        player.on(dashjs.MediaPlayer.events.MANIFEST_LOADED, onManifestLoaded);
        
        // Also listen to video element events as fallback
        video.addEventListener('loadedmetadata', () => {
          if (video.duration && !isNaN(video.duration) && isFinite(video.duration) && video.duration > 0) {
            clearTimeout(timeout);
            player.reset();
            resolve(video.duration);
          }
        }, { once: true });
        
        // Initialize the player
        player.initialize(video, url, false);
      } else {
        // Regular MP4 or other video format
        video.addEventListener('loadedmetadata', () => {
          if (video.duration && !isNaN(video.duration) && isFinite(video.duration)) {
            resolve(video.duration);
          } else {
            reject(new Error('Could not determine video duration'));
          }
          video.src = '';
        });
        
        video.addEventListener('error', () => {
          reject(new Error('Failed to load video metadata'));
          video.src = '';
        });
        
        video.src = url;
      }
    });
  }

  /**
   * Update source boundaries for timeline visualization
   */
  private updateSourceBoundaries(): void {
    const currentSources = this.sources();
    if (currentSources.length <= 1) {
      this.sourceBoundaries.set([]);
      return;
    }

    // Boundaries are at the end of each source (except the last one)
    const boundaries = currentSources
      .slice(0, -1)
      .map(source => source.startTime + source.duration);
    
    this.sourceBoundaries.set(boundaries);
  }

  /**
   * Recalculate start times and order for all sources
   */
  private recalculateSourceTimings(sources: VideoSource[]): VideoSource[] {
    let cumulativeTime = 0;
    return sources.map((source, index) => {
      const updated = {
        ...source,
        order: index,
        startTime: cumulativeTime
      };
      cumulativeTime += source.duration;
      return updated;
    });
  }

  /**
   * Load a specific source by index
   */
  /**
   * Advance to the next source when current one ends
   */
  private advanceToNextSource(): void {
    this.playerService.advanceToNext();
  }


  private timelineTimeFromEvent(event: PointerEvent, element: HTMLElement): number {
    const rect = element.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / rect.width;
    const clampedRatio = this.clamp(ratio, 0, 1);
    return this.clamp(clampedRatio * this.duration(), 0, this.duration());
  }

  private addTextOverlay(
    text: string,
    start: number,
    end: number,
    x: number,
    y: number,
    fontSize = 24,
    fontColor = '#FFFFFF',
    backgroundColor = 'transparent',
    opacity = 1
  ): void {
    const mode = this.timelineMode();
    const result = this.overlayService.addText(
      text, start, end, x, y, fontSize, fontColor, backgroundColor, opacity,
      this.duration(), mode, this.cuts(), this.segments()
    );
    
    if (result.success) {
      this.closeOverlayForm();
      this.errorMessage.set('');
    } else {
      this.errorMessage.set(result.error || 'Failed to add overlay.');
    }
  }

  private addImageOverlay(
    imageUrl: string,
    start: number,
    end: number,
    x: number,
    y: number,
    widthPercent = 20,
    heightPercent = 20,
    opacity = 1
  ): void {
    // Get actual video dimensions to convert percentage to pixels
    const video = this.videoElement?.nativeElement;
    const videoWidth = video?.videoWidth || 1920;
    const videoHeight = video?.videoHeight || 1080;
    
    const widthPixels = Math.round((widthPercent / 100) * videoWidth);
    const heightPixels = Math.round((heightPercent / 100) * videoHeight);
    
    console.log(`[addImageOverlay] Video: ${videoWidth}x${videoHeight}, Percent: ${widthPercent}%x${heightPercent}%, Pixels: ${widthPixels}x${heightPixels}`);

    const mode = this.timelineMode();
    const result = this.overlayService.addImage(
      imageUrl, start, end, x, y, widthPixels, heightPixels, opacity,
      this.duration(), mode, this.cuts(), this.segments()
    );
    
    if (result.success) {
      this.closeOverlayForm();
      this.errorMessage.set('');
    } else {
      this.errorMessage.set(result.error || 'Failed to add overlay.');
    }
  }

  /**
   * Get audio duration
   */
  private async getAudioDuration(url: string): Promise<number> {
    return new Promise((resolve, reject) => {
      const audio = new Audio();
      audio.preload = 'metadata';
      
      audio.addEventListener('loadedmetadata', () => {
        resolve(audio.duration);
        audio.src = '';
      });
      
      audio.addEventListener('error', () => {
        reject(new Error('Failed to load audio metadata'));
        audio.src = '';
      });
      
      audio.src = url;
    });
  }

  private addShapeOverlay(
    shapeType: 'rectangle',
    start: number,
    end: number,
    x: number,
    y: number,
    widthPercent = 20,
    heightPercent = 20,
    color = '#FF0000',
    strokeWidth = 3,
    fill = false,
    opacity = 1
  ): void {
    // Get actual video dimensions to convert percentage to pixels
    const video = this.videoElement?.nativeElement;
    const videoWidth = video?.videoWidth || 1920;
    const videoHeight = video?.videoHeight || 1080;
    
    const widthPixels = Math.round((widthPercent / 100) * videoWidth);
    const heightPixels = Math.round((heightPercent / 100) * videoHeight);
    
    console.log(`[addShapeOverlay] Video: ${videoWidth}x${videoHeight}, Percent: ${widthPercent}%x${heightPercent}%, Pixels: ${widthPixels}x${heightPixels}`);

    const mode = this.timelineMode();
    const result = this.overlayService.addShape(
      shapeType, start, end, x, y, widthPixels, heightPixels, 
      color, strokeWidth, fill, opacity,
      this.duration(), mode, this.cuts(), this.segments()
    );
    
    if (result.success) {
      this.closeOverlayForm();
      this.errorMessage.set('');
    } else {
      this.errorMessage.set(result.error || 'Failed to add overlay.');
    }
  }

  /**
   * Calculate the actual video bounds within the container,
   * accounting for letterboxing/pillarboxing due to aspect ratio preservation
   */
  private getActualVideoBounds(): VideoBounds | null {
    const video = this.videoElement?.nativeElement;
    const container = this.playerContainer?.nativeElement;
    if (!video || !container) return null;

    const containerRect = container.getBoundingClientRect();
    const videoWidth = video.videoWidth;
    const videoHeight = video.videoHeight;

    if (!videoWidth || !videoHeight) return null;

    // Calculate the video aspect ratio
    const videoAspect = videoWidth / videoHeight;
    const containerAspect = containerRect.width / containerRect.height;

    let actualWidth: number;
    let actualHeight: number;
    let offsetX: number;
    let offsetY: number;

    if (containerAspect > videoAspect) {
      // Container is wider: video will be letterboxed (black bars on sides)
      actualHeight = containerRect.height;
      actualWidth = actualHeight * videoAspect;
      offsetX = (containerRect.width - actualWidth) / 2;
      offsetY = 0;
    } else {
      // Container is taller: video will be pillarboxed (black bars on top/bottom)
      actualWidth = containerRect.width;
      actualHeight = actualWidth / videoAspect;
      offsetX = 0;
      offsetY = (containerRect.height - actualHeight) / 2;
    }

    return {
      x: offsetX,
      y: offsetY,
      width: actualWidth,
      height: actualHeight
    };
  }

  private clamp(value: number, min: number, max: number): number {
    return clamp(value, min, max);
  }

  /**
   * Initialize audio playback and sync with video
   */
  private initializeAudioPlayback(): void {
    // Get current audio sources to clean up elements for removed audio
    const currentAudioIds = new Set(this.audioSources().map(a => a.id));
    
    // Clean up audio elements that no longer exist
    this.audioElements.forEach((audioEl, id) => {
      if (!currentAudioIds.has(id)) {
        console.log(`[VideoEditor] Cleaning up audio element for removed track ${id}`);
        this.cleanupAudioElement(id);
      }
    });

    const activeAudio = this.activeAudioSources();
    const masterVolume = this.masterVolume();

    console.log(`[VideoEditor] Initializing audio playback for ${activeAudio.length} active audio source(s)`);
    activeAudio.forEach(audio => {
      console.log(`[VideoEditor] Creating audio element for track ${audio.id}: [${audio.startTime}s - ${audio.startTime + audio.duration}s]`);
    });

    // Create or update audio elements for active audio sources
    activeAudio.forEach(audio => {
      let audioEl = this.audioElements.get(audio.id);
      
      if (!audioEl) {
        // Create new audio element
        audioEl = new Audio(audio.url);
        audioEl.preload = 'auto';
        this.audioElements.set(audio.id, audioEl);
      }
      
      // Update volume
      audioEl.volume = audio.volume * masterVolume;
    });

    // Set up sync with video playback
    this.syncAudioWithVideo();
  }

  /**
   * Sync audio playback with video
   */
  private syncAudioWithVideo(): void {
    // Clear existing interval
    if (this.audioPlaybackInterval) {
      clearInterval(this.audioPlaybackInterval);
    }

    // Sync audio every 250ms (less frequent for better performance)
    this.audioPlaybackInterval = window.setInterval(() => {
      const video = this.videoElement?.nativeElement;
      if (!video) return;

      const currentTime = this.currentTime();
      const isPlaying = !video.paused;
      const activeAudio = this.activeAudioSources();
      const masterVolume = this.masterVolume();

      activeAudio.forEach(audio => {
        const audioEl = this.audioElements.get(audio.id);
        if (!audioEl) return;

        const audioStart = audio.startTime;
        const audioEnd = audio.startTime + audio.duration;

        // Update volume (only if changed to avoid unnecessary updates)
        const targetVolume = audio.volume * masterVolume;
        if (Math.abs(audioEl.volume - targetVolume) > 0.01) {
          audioEl.volume = targetVolume;
        }

        if (currentTime >= audioStart && currentTime < audioEnd) {
          // Audio should be playing
          // Calculate position within the trimmed audio
          const timelineOffset = currentTime - audioStart;
          // Add the trim start to get the position in the original audio file
          const audioTrimStart = audio.audioTrimStart ?? 0;
          const audioTrimEnd = audio.audioTrimEnd ?? audio.originalDuration ?? audio.duration;
          const audioCurrentTime = audioTrimStart + timelineOffset;
          
          // Ensure we don't play beyond the trim end
          if (audioCurrentTime >= audioTrimEnd) {
            audioEl.pause();
            return;
          }
          
          // Only seek if drift is significant (0.25s threshold to reduce glitches)
          const drift = Math.abs(audioEl.currentTime - audioCurrentTime);
          if (drift > 0.25) {
            audioEl.currentTime = audioCurrentTime;
          }

          if (isPlaying && audioEl.paused) {
            void audioEl.play().catch(err => {
              console.warn(`[VideoEditor] Failed to play audio ${audio.id}:`, err);
            });
          } else if (!isPlaying && !audioEl.paused) {
            audioEl.pause();
          }
        } else {
          // Audio should be paused
          if (!audioEl.paused) {
            audioEl.pause();
          }
          // Reset position if we're before the audio start
          if (currentTime < audioStart) {
            audioEl.currentTime = audio.audioTrimStart ?? 0;
          }
        }
      });
    }, 250);
  }

  /**
   * Clean up a specific audio element
   */
  private cleanupAudioElement(id: number): void {
    const audioEl = this.audioElements.get(id);
    if (audioEl) {
      audioEl.pause();
      audioEl.src = '';
      audioEl.load();
      this.audioElements.delete(id);
    }
  }

  /**
   * Clean up all audio elements
   */
  private cleanupAudioElements(): void {
    this.audioElements.forEach((audioEl) => {
      audioEl.pause();
      audioEl.src = '';
      audioEl.load();
    });
    this.audioElements.clear();
  }

  /**
   * Adjust audio positions when cuts are applied
   */
  private adjustAudioForCuts(): void {
    const cuts = this.cutsRaw();
    if (cuts.length === 0) {
      console.log(`[VideoEditor] No cuts to adjust audio for`);
      return;
    }

    console.log(`[VideoEditor] Adjusting audio for ${cuts.length} cut(s)`);
    const videoDuration = this.duration();
    const audioBefore = this.audioSources();
    console.log(`[VideoEditor] Audio before adjustment:`, audioBefore.map(a => `ID ${a.id}: [${a.startTime}s - ${a.startTime + a.duration}s]`));
    
    // Clean up all existing audio elements before adjusting
    // This ensures that when audio is split, old elements are properly removed
    this.cleanupAudioElements();
    
    this.audioService.adjustAudioForCuts(
      cuts.map(c => ({ start: c.start, end: c.end })),
      videoDuration
    );
    
    const audioAfter = this.audioSources();
    console.log(`[VideoEditor] Audio after adjustment:`, audioAfter.map(a => `ID ${a.id}: [${a.startTime}s - ${a.startTime + a.duration}s]`));
    console.log(`[VideoEditor] Audio adjustment: ${audioBefore.length} -> ${audioAfter.length} tracks`);
    
    // Reinitialize playback with adjusted audio (will create new elements)
    this.initializeAudioPlayback();
  }
}
