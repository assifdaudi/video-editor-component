import { CommonModule } from '@angular/common';
import {
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
  computed,
  inject,
  signal
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { ReactiveFormsModule, Validators, FormBuilder } from '@angular/forms';
import * as dashjs from 'dashjs';
import { environment } from '../../environments/environment';

interface TimelineCut {
  id: number;
  start: number;
  end: number;
}

interface RenderResponse {
  jobId: string;
  outputFile: string;
  segments: Array<{ start: number; end: number }>;
}

@Component({
  selector: 'app-video-editor',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './video-editor.component.html',
  styleUrl: './video-editor.component.scss'
})
export class VideoEditorComponent implements OnDestroy {
  @ViewChild('videoEl', { static: true }) private videoElement?: ElementRef<HTMLVideoElement>;

  private readonly fb = inject(FormBuilder);
  private readonly http = inject(HttpClient);
  protected readonly backendHost = environment.apiBaseUrl;

  protected readonly sourceForm = this.fb.nonNullable.group({
    sourceUrl: ['', [Validators.required]]
  });

  protected readonly loading = signal(false);
  protected readonly errorMessage = signal('');
  protected readonly duration = signal(0);
  protected readonly currentTime = signal(0);
  protected readonly trimStart = signal(0);
  protected readonly trimEnd = signal(0);
  protected readonly sourceLoaded = signal(false);
  protected readonly cuts = signal<TimelineCut[]>([]);
  protected readonly cutSelection = signal({ start: 0, end: 0 });
  protected readonly renderBusy = signal(false);
  protected readonly renderResult = signal<RenderResponse | null>(null);
  protected readonly timelineSelection = signal<{ start: number; end: number } | null>(null);

  protected readonly trimmedLength = computed(
    () => Math.max(this.trimEnd() - this.trimStart(), 0)
  );

  protected readonly hasCuts = computed(() => this.cuts().length > 0);
  protected readonly canRender = computed(
    () => this.sourceLoaded() && this.duration() > 0 && !this.loading()
  );

  private dashPlayer?: dashjs.MediaPlayerClass;
  private cutCounter = 0;
  private readonly minGap = 0.1;
  private timelineDrag:
    | { pointerId: number; anchor: number; mode: 'selection' }
    | { pointerId: number; anchor: number; mode: 'playhead' }
    | null = null;

  ngOnDestroy(): void {
    this.dashPlayer?.reset();
  }

  protected loadVideo(): void {
    this.errorMessage.set('');
    if (this.sourceForm.invalid) {
      this.sourceForm.markAllAsTouched();
      return;
    }

    const rawValue = this.sourceForm.controls.sourceUrl.value ?? '';
    const url = rawValue.trim();
    const video = this.videoElement?.nativeElement;

    if (!url || !video) {
      this.errorMessage.set('Provide a valid MP4 or MPD url.');
      return;
    }

    this.resetEditor();
    this.loading.set(true);
    this.renderResult.set(null);
    const isMpd = url.toLowerCase().endsWith('.mpd');

    if (isMpd) {
      this.dashPlayer = dashjs.MediaPlayer().create();
      this.dashPlayer.initialize(video, url, true);
    } else {
      video.src = url;
      video.load();
    }

    this.loading.set(false);
    this.sourceLoaded.set(true);
  }

  protected resetEditor(clearSource = false): void {
    if (clearSource) {
      this.sourceForm.reset();
    }
    this.loading.set(false);
    this.sourceLoaded.set(false);
    this.renderBusy.set(false);
    this.renderResult.set(null);
    this.duration.set(0);
    this.currentTime.set(0);
    this.trimStart.set(0);
    this.trimEnd.set(0);
    this.cuts.set([]);
    this.cutSelection.set({ start: 0, end: 0 });
    this.timelineSelection.set(null);
    this.errorMessage.set('');

    const video = this.videoElement?.nativeElement;
    if (video) {
      video.pause();
      video.removeAttribute('src');
      video.load();
    }

    this.dashPlayer?.reset();
    this.dashPlayer = undefined;
  }

  protected onMetadataLoaded(): void {
    const duration = this.videoElement?.nativeElement.duration ?? 0;

    if (!isFinite(duration) || duration <= 0) {
      this.errorMessage.set(
        'Unable to detect duration. Streams without fixed length are not supported.'
      );
      return;
    }

    this.duration.set(duration);
    this.trimStart.set(0);
    this.trimEnd.set(duration);
    this.cutSelection.set({
      start: Math.min(duration * 0.25, duration - this.minGap),
      end: Math.min(duration * 0.4, duration)
    });
  }

  protected onTimeUpdate(): void {
    const video = this.videoElement?.nativeElement;
    if (!video) {
      return;
    }
    this.currentTime.set(video.currentTime);
  }

  protected onVideoError(): void {
    this.errorMessage.set('Unable to load the provided source.');
  }

  protected updateTrimStart(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    const clamped = Math.min(value, this.trimEnd() - this.minGap);
    this.trimStart.set(this.clamp(clamped, 0, this.duration()));
  }

  protected updateTrimEnd(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    const clamped = Math.max(value, this.trimStart() + this.minGap);
    this.trimEnd.set(this.clamp(clamped, 0, this.duration()));
  }

  protected setTrimStartFromCurrent(): void {
    this.trimStart.set(this.clamp(this.currentTime(), 0, this.trimEnd() - this.minGap));
  }

  protected setTrimEndFromCurrent(): void {
    this.trimEnd.set(
      this.clamp(this.currentTime(), this.trimStart() + this.minGap, this.duration())
    );
  }

  protected togglePlayPause(): void {
    const video = this.videoElement?.nativeElement;
    if (!video) {
      return;
    }
    if (video.paused) {
      void video.play();
    } else {
      video.pause();
    }
  }

  protected jumpTo(time: number): void {
    const video = this.videoElement?.nativeElement;
    if (!video) {
      return;
    }
    video.currentTime = this.clamp(time, 0, this.duration());
  }

  protected setCutStartFromCurrent(): void {
    const start = this.clamp(
      this.currentTime(),
      this.trimStart(),
      this.trimEnd() - this.minGap
    );
    const nextEnd = Math.max(start + this.minGap, this.cutSelection().end);
    this.cutSelection.set({
      start,
      end: this.clamp(nextEnd, start + this.minGap, this.trimEnd())
    });
  }

  protected setCutEndFromCurrent(): void {
    const start = this.cutSelection().start;
    this.cutSelection.set({
      start,
      end: this.clamp(this.currentTime(), start + this.minGap, this.trimEnd())
    });
  }

  protected updateCutSelection(field: 'start' | 'end', event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    const next = { ...this.cutSelection() };
    next[field] = value;
    if (field === 'start') {
      next.start = this.clamp(value, this.trimStart(), next.end - this.minGap);
    } else {
      next.end = this.clamp(value, next.start + this.minGap, this.trimEnd());
    }
    this.cutSelection.set(next);
  }

  protected addCut(): void {
    const { start, end } = this.cutSelection();
    const newCut = this.addCutRange(start, end);
    if (newCut) {
      this.cutSelection.set({ start: newCut.start, end: newCut.end });
    }
  }

  protected removeCut(id: number): void {
    this.cuts.set(this.cuts().filter(cut => cut.id !== id));
  }

  protected removeCutFromTimeline(id: number, event?: Event): void {
    event?.stopPropagation();
    this.removeCut(id);
  }

  protected focusCut(cut: TimelineCut, event?: Event): void {
    event?.stopPropagation();
    this.cutSelection.set({ start: cut.start, end: cut.end });
  }

  private addCutRange(start: number, end: number): TimelineCut | null {
    const clampedStart = this.clamp(start, this.trimStart(), this.trimEnd() - this.minGap);
    const clampedEnd = this.clamp(end, clampedStart + this.minGap, this.trimEnd());
    if (clampedEnd - clampedStart < this.minGap) {
      this.errorMessage.set('Cut length must be greater than 100ms.');
      return null;
    }

    const overlapping = this.cuts().some(
      cut => !(clampedEnd <= cut.start || clampedStart >= cut.end)
    );

    if (overlapping) {
      this.errorMessage.set('Cut overlaps with another segment.');
      return null;
    }

    const newCut: TimelineCut = {
      id: ++this.cutCounter,
      start: clampedStart,
      end: clampedEnd
    };

    const sortedCuts = [...this.cuts(), newCut].sort((a, b) => a.start - b.start);
    this.cuts.set(sortedCuts);
    this.errorMessage.set('');
    return newCut;
  }

  protected formatTime(value: number): string {
    if (!isFinite(value)) {
      return '0:00';
    }
    const totalSeconds = Math.max(value, 0);
    const hours = Math.floor(totalSeconds / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    const secs = Math.floor(totalSeconds % 60);
    const pad = (n: number) => n.toString().padStart(2, '0');
    return hours > 0 ? `${hours}:${pad(mins)}:${pad(secs)}` : `${mins}:${pad(secs)}`;
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
      this.jumpTo(time);
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
      this.jumpTo(time);
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
    this.timelineDrag = null;

    if (drag.mode === 'selection' && selection) {
      const newCut = this.addCutRange(selection.start, selection.end);
      if (newCut) {
        this.cutSelection.set({ start: newCut.start, end: newCut.end });
      }
    }
    this.timelineSelection.set(null);
  }

  protected onTimelinePointerLeave(): void {
    if (!this.timelineDrag) {
      this.timelineSelection.set(null);
    }
  }

  private timelineTimeFromEvent(event: PointerEvent, element: HTMLElement): number {
    const rect = element.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / rect.width;
    const clampedRatio = this.clamp(ratio, 0, 1);
    return this.clamp(clampedRatio * this.duration(), 0, this.duration());
  }

  protected renderViaBackend(): void {
    if (!this.canRender()) {
      this.errorMessage.set('Load a video and set trim points before rendering.');
      return;
    }

    const sourceUrl = this.sourceForm.controls.sourceUrl.value?.trim() ?? '';
    if (!sourceUrl) {
      this.errorMessage.set('Provide a source URL first.');
      return;
    }

    const payload = {
      sourceUrl,
      trimStart: this.trimStart(),
      trimEnd: this.trimEnd(),
      cuts: this.cuts().map(({ start, end }) => ({ start, end })),
      format: 'mp4'
    };

    this.renderBusy.set(true);
    this.renderResult.set(null);
    this.errorMessage.set('');

    this.http.post<RenderResponse>(`${environment.apiBaseUrl}/api/render`, payload).subscribe({
      next: response => {
        this.renderResult.set(response);
        this.renderBusy.set(false);
      },
      error: err => {
        const message =
          err?.error?.error ||
          err?.message ||
          'Render request failed. Ensure the backend server is running.';
        this.errorMessage.set(message);
        this.renderBusy.set(false);
      }
    });
  }

  protected renderDownloadUrl(): string | null {
    const result = this.renderResult();
    if (!result) {
      return null;
    }
    return `${environment.apiBaseUrl}${result.outputFile}`;
  }

  private clamp(value: number, min: number, max: number): number {
    if (Number.isNaN(value)) {
      return min;
    }
    return Math.min(Math.max(value, min), max);
  }
}

