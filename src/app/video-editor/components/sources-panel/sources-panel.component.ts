import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { VideoSource } from '../../video-editor.types';
import { formatTime } from '../../video-editor.utils';

@Component({
  selector: 'app-sources-panel',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './sources-panel.component.html',
  styleUrl: './sources-panel.component.scss'
})
export class SourcesPanelComponent {
  @Input() sources: VideoSource[] = [];
  @Input() duration = 0;
  @Input() editingSourceId: number | null = null;

  @Output() removeSource = new EventEmitter<number>();
  @Output() moveSourceUp = new EventEmitter<number>();
  @Output() moveSourceDown = new EventEmitter<number>();
  @Output() startEditing = new EventEmitter<number>();
  @Output() cancelEditing = new EventEmitter<void>();
  @Output() updateDuration = new EventEmitter<{ id: number; duration: number }>();

  protected readonly formatTime = formatTime;

  protected onRemove(id: number): void {
    this.removeSource.emit(id);
  }

  protected onMoveUp(id: number): void {
    this.moveSourceUp.emit(id);
  }

  protected onMoveDown(id: number): void {
    this.moveSourceDown.emit(id);
  }

  protected onStartEditing(id: number): void {
    this.startEditing.emit(id);
  }

  protected onCancelEditing(): void {
    this.cancelEditing.emit();
  }

  protected onUpdateDuration(id: number, value: string): void {
    const duration = parseFloat(value);
    if (!isNaN(duration) && duration > 0) {
      this.updateDuration.emit({ id, duration });
    }
  }

  protected canMoveUp(source: VideoSource): boolean {
    return source.order > 0;
  }

  protected canMoveDown(source: VideoSource): boolean {
    return source.order < this.sources.length - 1;
  }
}

