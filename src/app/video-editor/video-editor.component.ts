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

interface TextOverlay {
  id: number;
  type: 'text';
  text: string;
  start: number;
  end: number;
  x: number; // 0-100 percentage
  y: number; // 0-100 percentage
  fontSize?: number;
  fontColor?: string;
  backgroundColor?: string;
  opacity?: number;
}

interface ImageOverlay {
  id: number;
  type: 'image';
  imageUrl: string;
  start: number;
  end: number;
  x: number; // 0-100 percentage
  y: number; // 0-100 percentage
  width?: number; // 0-100 percentage
  height?: number; // 0-100 percentage
  opacity?: number;
}

interface ShapeOverlay {
  id: number;
  type: 'shape';
  shapeType: 'circle' | 'rectangle' | 'arrow';
  start: number;
  end: number;
  x: number; // 0-100 percentage
  y: number; // 0-100 percentage
  width?: number; // 0-100 percentage
  height?: number; // 0-100 percentage
  color?: string;
  strokeWidth?: number;
  fill?: boolean;
  opacity?: number;
}

type Overlay = TextOverlay | ImageOverlay | ShapeOverlay;

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
  @ViewChild('overlayFormContainer', { static: false }) private overlayFormContainer?: ElementRef<HTMLElement>;
  @ViewChild('playerContainer', { static: false }) private playerContainer?: ElementRef<HTMLElement>;

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
  protected readonly overlays = signal<Overlay[]>([]);
  protected readonly overlaySelection = signal<Overlay | null>(null);
  protected readonly showOverlayForm = signal(false);
  protected readonly overlayFormType = signal<'text' | 'image' | 'shape'>('text');
  protected readonly renderBusy = signal(false);
  protected readonly renderResult = signal<RenderResponse | null>(null);
  protected readonly timelineSelection = signal<{ start: number; end: number } | null>(null);
  protected readonly draggingOverlay = signal<{ overlay: Overlay; startX: number; startY: number; offsetX: number; offsetY: number } | null>(null);
  protected readonly resizingOverlay = signal<{ overlay: Overlay; startWidth: number; startHeight: number; startX: number; startY: number; corner: 'se' | 'sw' | 'ne' | 'nw' } | null>(null);

  protected readonly trimmedLength = computed(
    () => Math.max(this.trimEnd() - this.trimStart(), 0)
  );

  protected readonly hasCuts = computed(() => this.cuts().length > 0);
  protected readonly canRender = computed(
    () => this.sourceLoaded() && this.duration() > 0 && !this.loading()
  );

  private dashPlayer?: dashjs.MediaPlayerClass;
  private cutCounter = 0;
  private overlayCounter = 0;
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
    if (!text.trim() || start >= end || end > this.duration()) {
      this.errorMessage.set('Invalid overlay parameters.');
      return;
    }

    const overlay: TextOverlay = {
      id: ++this.overlayCounter,
      type: 'text',
      text: text.trim(),
      start: this.clamp(start, 0, this.duration()),
      end: this.clamp(end, start + 0.1, this.duration()),
      x: this.clamp(x, 0, 100),
      y: this.clamp(y, 0, 100),
      fontSize,
      fontColor,
      backgroundColor,
      opacity: this.clamp(opacity, 0, 1)
    };

    this.overlays.set([...this.overlays(), overlay].sort((a, b) => a.start - b.start));
    this.closeOverlayForm();
    this.errorMessage.set('');
  }

  private addImageOverlay(
    imageUrl: string,
    start: number,
    end: number,
    x: number,
    y: number,
    width = 20,
    height = 20,
    opacity = 1
  ): void {
    if (!imageUrl.trim() || start >= end || end > this.duration()) {
      this.errorMessage.set('Invalid overlay parameters.');
      return;
    }

    const overlay: ImageOverlay = {
      id: ++this.overlayCounter,
      type: 'image',
      imageUrl: imageUrl.trim(),
      start: this.clamp(start, 0, this.duration()),
      end: this.clamp(end, start + 0.1, this.duration()),
      x: this.clamp(x, 0, 100),
      y: this.clamp(y, 0, 100),
      width: this.clamp(width, 1, 100),
      height: this.clamp(height, 1, 100),
      opacity: this.clamp(opacity, 0, 1)
    };

    this.overlays.set([...this.overlays(), overlay].sort((a, b) => a.start - b.start));
    this.closeOverlayForm();
    this.errorMessage.set('');
  }

  protected addShapeOverlayFromForm(): void {
    if (!this.overlayFormContainer?.nativeElement) {
      return;
    }
    const container = this.overlayFormContainer.nativeElement;
    const shapeTypeSelect = container.querySelector<HTMLSelectElement>('#shapeType');
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

    if (!shapeTypeSelect || !startInput || !endInput || !xInput || !yInput || !widthInput || !heightInput || !colorInput || !strokeWidthInput || !fillInput || !opacityInput) {
      return;
    }

    const shapeType = shapeTypeSelect.value as 'circle' | 'rectangle' | 'arrow';
    const start = Number(startInput.value) || 0;
    const end = Number(endInput.value) || 0;
    const x = Number(xInput.value) || 10;
    const y = Number(yInput.value) || 10;
    const width = Number(widthInput.value) || 20;
    const height = Number(heightInput.value) || 20;
    const color = colorInput.value || '#FF0000';
    const strokeWidth = Number(strokeWidthInput.value) || 3;
    const fill = fillInput.checked;
    const opacity = Number(opacityInput.value) || 1;

    this.addShapeOverlay(shapeType, start, end, x, y, width, height, color, strokeWidth, fill, opacity);
  }

  private addShapeOverlay(
    shapeType: 'circle' | 'rectangle' | 'arrow',
    start: number,
    end: number,
    x: number,
    y: number,
    width = 20,
    height = 20,
    color = '#FF0000',
    strokeWidth = 3,
    fill = false,
    opacity = 1
  ): void {
    if (start >= end || end > this.duration()) {
      this.errorMessage.set('Invalid overlay parameters.');
      return;
    }

    const overlay: ShapeOverlay = {
      id: ++this.overlayCounter,
      type: 'shape',
      shapeType,
      start: this.clamp(start, 0, this.duration()),
      end: this.clamp(end, start + 0.1, this.duration()),
      x: this.clamp(x, 0, 100),
      y: this.clamp(y, 0, 100),
      width: this.clamp(width, 1, 100),
      height: this.clamp(height, 1, 100),
      color,
      strokeWidth: this.clamp(strokeWidth, 1, 20),
      fill,
      opacity: this.clamp(opacity, 0, 1)
    };

    this.overlays.set([...this.overlays(), overlay].sort((a, b) => a.start - b.start));
    this.closeOverlayForm();
    this.errorMessage.set('');
  }

  protected removeOverlay(id: number): void {
    this.overlays.set(this.overlays().filter(overlay => overlay.id !== id));
  }

  protected focusOverlay(overlay: Overlay, event?: Event): void {
    event?.stopPropagation();
    this.overlaySelection.set(overlay);
    this.jumpTo(overlay.start);
  }

  protected hasOverlays = computed(() => this.overlays().length > 0);

  protected getOverlayTitle(overlay: Overlay): string {
    if (overlay.type === 'text') {
      return overlay.text;
    }
    if (overlay.type === 'shape') {
      return `${overlay.shapeType.charAt(0).toUpperCase() + overlay.shapeType.slice(1)} shape`;
    }
    return 'Image overlay';
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

  protected getShapeOverlayType(overlay: Overlay): 'circle' | 'rectangle' | 'arrow' | null {
    return overlay.type === 'shape' ? overlay.shapeType : null;
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
    const width = overlay.type === 'image' ? this.getImageOverlayWidth(overlay) : (overlay.width || 20);
    if (!bounds) return width;
    
    const container = this.playerContainer?.nativeElement;
    if (!container) return width;
    
    const containerRect = container.getBoundingClientRect();
    // Convert video percentage to container percentage
    return ((width / 100) * bounds.width / containerRect.width) * 100;
  }

  protected getOverlayHeightInContainer(overlay: Overlay): number {
    if (overlay.type === 'text') return 0;
    
    const bounds = this.getActualVideoBounds();
    const height = overlay.type === 'image' ? this.getImageOverlayHeight(overlay) : (overlay.height || 20);
    if (!bounds) return height;
    
    const container = this.playerContainer?.nativeElement;
    if (!container) return height;
    
    const containerRect = container.getBoundingClientRect();
    // Convert video percentage to container percentage
    return ((height / 100) * bounds.height / containerRect.height) * 100;
  }

  /**
   * Calculate the actual video bounds within the container,
   * accounting for letterboxing/pillarboxing due to aspect ratio preservation
   */
  private getActualVideoBounds(): { x: number; y: number; width: number; height: number } | null {
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
    
    if (event.target instanceof HTMLElement) {
      event.target.setPointerCapture(event.pointerId);
    }
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
    if (overlay.type !== 'image' && overlay.type !== 'shape') return;
    event.preventDefault();
    event.stopPropagation();
    const container = this.playerContainer?.nativeElement;
    if (!container) return;
    
    const rect = container.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    
    this.resizingOverlay.set({
      overlay,
      startWidth: overlay.width || 20,
      startHeight: overlay.height || 20,
      startX,
      startY,
      corner
    });
    
    if (event.target instanceof HTMLElement) {
      event.target.setPointerCapture(event.pointerId);
    }
  }

  protected resizeOverlay(event: PointerEvent): void {
    const resize = this.resizingOverlay();
    if (!resize) return;
    
    const videoBounds = this.getActualVideoBounds();
    if (!videoBounds) return;
    
    // Calculate delta based on actual video bounds
    const deltaX = ((event.clientX - resize.startX) / videoBounds.width) * 100;
    const deltaY = ((event.clientY - resize.startY) / videoBounds.height) * 100;
    
    let newWidth = resize.startWidth;
    let newHeight = resize.startHeight;
    let newX = resize.overlay.x;
    let newY = resize.overlay.y;
    
    // Adjust based on corner
    if (resize.corner === 'se') {
      // Southeast: adjust width and height, keep x,y
      newWidth = this.clamp(resize.startWidth + deltaX, 1, 100);
      newHeight = this.clamp(resize.startHeight + deltaY, 1, 100);
    } else if (resize.corner === 'sw') {
      // Southwest: adjust width (negative), height, and x
      newWidth = this.clamp(resize.startWidth - deltaX, 1, 100);
      newHeight = this.clamp(resize.startHeight + deltaY, 1, 100);
      newX = this.clamp(resize.overlay.x + deltaX, 0, 100);
    } else if (resize.corner === 'ne') {
      // Northeast: adjust width, height (negative), and y
      newWidth = this.clamp(resize.startWidth + deltaX, 1, 100);
      newHeight = this.clamp(resize.startHeight - deltaY, 1, 100);
      newY = this.clamp(resize.overlay.y + deltaY, 0, 100);
    } else if (resize.corner === 'nw') {
      // Northwest: adjust width (negative), height (negative), x, and y
      newWidth = this.clamp(resize.startWidth - deltaX, 1, 100);
      newHeight = this.clamp(resize.startHeight - deltaY, 1, 100);
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
    
    // Update form inputs if form is open
    if (this.overlayFormContainer?.nativeElement && this.showOverlayForm()) {
      const formContainer = this.overlayFormContainer.nativeElement;
      const xInput = formContainer.querySelector<HTMLInputElement>('#imageX');
      const yInput = formContainer.querySelector<HTMLInputElement>('#imageY');
      const widthInput = formContainer.querySelector<HTMLInputElement>('#imageWidth');
      const heightInput = formContainer.querySelector<HTMLInputElement>('#imageHeight');
      if (xInput) xInput.value = newX.toString();
      if (yInput) yInput.value = newY.toString();
      if (widthInput) widthInput.value = newWidth.toString();
      if (heightInput) heightInput.value = newHeight.toString();
    }
  }

  protected stopResizeOverlay(): void {
    this.resizingOverlay.set(null);
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
      overlays: this.overlays(),
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

