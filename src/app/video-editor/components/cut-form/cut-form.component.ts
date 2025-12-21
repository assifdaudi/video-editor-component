import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output, signal, effect } from '@angular/core';
import { ModalComponent } from '../shared/modal/modal.component';

@Component({
  selector: 'app-cut-form',
  standalone: true,
  imports: [CommonModule, ModalComponent],
  templateUrl: './cut-form.component.html',
  styleUrl: './cut-form.component.scss'
})
export class CutFormComponent {
  @Input() isOpen = false;
  @Input() timelineMode: 'cut' | 'keep' = 'cut';
  @Input() duration = 0;
  @Input() currentTime = 0;
  @Input() cutStart = 0;
  @Input() cutEnd = 0;
  @Input() segmentStart = 0;
  @Input() segmentEnd = 0;

  @Output() closed = new EventEmitter<void>();
  @Output() cutAdded = new EventEmitter<void>();
  @Output() segmentAdded = new EventEmitter<void>();
  @Output() startChanged = new EventEmitter<number>();
  @Output() endChanged = new EventEmitter<number>();
  @Output() usePlayheadForStart = new EventEmitter<void>();
  @Output() usePlayheadForEnd = new EventEmitter<void>();

  protected readonly start = signal(0);
  protected readonly end = signal(0);

  constructor() {
    effect(() => {
      if (this.timelineMode === 'cut') {
        this.start.set(this.cutStart);
        this.end.set(this.cutEnd);
      } else {
        this.start.set(this.segmentStart);
        this.end.set(this.segmentEnd);
      }
    });
  }

  protected onStartChange(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    const num = parseFloat(value) || 0;
    this.start.set(num);
    this.startChanged.emit(num);
  }

  protected onEndChange(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    const num = parseFloat(value) || 0;
    this.end.set(num);
    this.endChanged.emit(num);
  }

  protected onUsePlayheadForStart(): void {
    this.start.set(this.currentTime);
    this.startChanged.emit(this.currentTime);
  }

  protected onUsePlayheadForEnd(): void {
    this.end.set(this.currentTime);
    this.endChanged.emit(this.currentTime);
  }

  protected onSubmit(): void {
    if (this.timelineMode === 'cut') {
      this.cutAdded.emit();
    } else {
      this.segmentAdded.emit();
    }
    this.onClose();
  }

  protected onClose(): void {
    this.closed.emit();
  }
}

