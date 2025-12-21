import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output, computed, inject, signal } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators, FormGroup } from '@angular/forms';
import { FileInputComponent } from '../shared/file-input/file-input.component';
import { createLocalFileUrl } from '../../utils/file-upload.utils';
import { getVideoDuration } from '../../utils/video-metadata.utils';

@Component({
  selector: 'app-source-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, FileInputComponent],
  templateUrl: './source-form.component.html',
  styleUrl: './source-form.component.scss'
})
export class SourceFormComponent {
  @Input() loading = false;
  @Output() sourceAdded = new EventEmitter<{ url: string; duration?: number }>();
  @Output() fileSelected = new EventEmitter<File>();

  protected readonly sourceForm: FormGroup;
  protected readonly isImageUrl = computed(() => {
    const url = this.sourceForm.controls['sourceUrl'].value?.toLowerCase() || '';
    return !!url.match(/\.(jpg|jpeg|png|gif|webp)$/);
  });

  protected readonly isDraggingSource = signal(false);

  private readonly fb = inject(FormBuilder);

  constructor() {
    this.sourceForm = this.fb.nonNullable.group({
      sourceUrl: ['', [Validators.required]],
      imageDuration: [5, [Validators.required, Validators.min(0.1), Validators.max(60)]]
    });
  }

  protected async onSubmit(): Promise<void> {
    if (this.sourceForm.invalid) {
      return;
    }

    const url = this.sourceForm.controls['sourceUrl'].value;
    const imageDuration = this.sourceForm.controls['imageDuration'].value;

    if (this.isImageUrl()) {
      this.sourceAdded.emit({ url, duration: imageDuration });
    } else {
      // For videos, duration will be determined by the parent
      this.sourceAdded.emit({ url });
    }

    this.sourceForm.reset({
      sourceUrl: '',
      imageDuration: 5
    });
  }

  protected async onFileSelected(file: File): Promise<void> {
    this.fileSelected.emit(file);
    
    // Create object URL for preview
    const objectUrl = createLocalFileUrl(file);
    this.sourceForm.controls['sourceUrl'].setValue(objectUrl);

    // Get duration for video files
    if (file.type.startsWith('video/') || file.name.toLowerCase().endsWith('.mpd')) {
      try {
        await getVideoDuration(objectUrl);
        // Duration will be set when source is added
      } catch (error) {
        console.error('Failed to get video duration:', error);
      }
    }
  }

  protected onDragStateChange(isDragging: boolean): void {
    this.isDraggingSource.set(isDragging);
  }
}

