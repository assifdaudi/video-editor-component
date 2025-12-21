import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output, signal, effect } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FileInputComponent } from '../shared/file-input/file-input.component';
import { ModalComponent } from '../shared/modal/modal.component';
import { createLocalFileUrl } from '../../utils/file-upload.utils';

@Component({
  selector: 'app-audio-form',
  standalone: true,
  imports: [CommonModule, FormsModule, FileInputComponent, ModalComponent],
  templateUrl: './audio-form.component.html',
  styleUrl: './audio-form.component.scss'
})
export class AudioFormComponent {
  @Input() isOpen = false;
  @Input() currentTime = 0;
  @Input() duration = 0;

  @Output() closed = new EventEmitter<void>();
  @Output() audioAdded = new EventEmitter<{ url: string; startTime: number }>();
  @Output() fileSelected = new EventEmitter<{ file: File; url: string }>();

  protected audioUrl = '';
  protected readonly audioStart = signal(0);
  protected readonly isDraggingAudio = signal(false);

  constructor() {
    effect(() => {
      // Update audioStart when currentTime changes
      if (this.audioStart() === 0 && this.currentTime > 0) {
        this.audioStart.set(this.currentTime);
      }
    });
  }

  protected onStartTimeChange(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    const time = parseFloat(value) || this.currentTime;
    this.audioStart.set(time);
  }

  protected async onFileSelected(file: File): Promise<void> {
    // Create object URL for immediate preview in the form
    const objectUrl = createLocalFileUrl(file);
    this.audioUrl = objectUrl;
    // Emit both file and URL so parent can store the file with this URL
    this.fileSelected.emit({ file, url: objectUrl });
  }

  protected onDragStateChange(isDragging: boolean): void {
    this.isDraggingAudio.set(isDragging);
  }

  protected onSubmit(): void {
    const url = this.audioUrl.trim();
    const startTime = this.audioStart();

    if (!url) {
      return;
    }

    this.audioAdded.emit({ url, startTime });
    this.audioUrl = '';
    this.audioStart.set(this.currentTime);
  }

  protected onClose(): void {
    this.closed.emit();
    this.audioUrl = '';
    this.audioStart.set(this.currentTime);
  }
}

