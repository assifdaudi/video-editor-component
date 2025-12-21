import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output, signal, ViewChild, ElementRef } from '@angular/core';
import { ControlValueAccessor, FormsModule, NG_VALUE_ACCESSOR } from '@angular/forms';
import { isValidSourceFile, isValidAudioFile, isValidImageFile } from '../../../utils/file-upload.utils';

export type FileInputType = 'source' | 'audio' | 'image';

@Component({
  selector: 'app-file-input',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './file-input.component.html',
  styleUrl: './file-input.component.scss',
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: FileInputComponent,
      multi: true
    }
  ]
})
export class FileInputComponent implements ControlValueAccessor {
  // eslint-disable @typescript-eslint/member-ordering
  @Input() accept = '';
  @Input() placeholder = 'Enter URL or drag & drop files here';
  @Input() type: FileInputType = 'source';
  @Input() inputId = '';
  
  @Output() fileSelected = new EventEmitter<File>();
  @Output() dragStateChange = new EventEmitter<boolean>();

  @ViewChild('fileInput', { static: false }) fileInput?: ElementRef<HTMLInputElement>;

  protected readonly isDragging = signal(false);
  protected value = '';

  // ControlValueAccessor implementation - must be public
  writeValue(value: string): void {
    this.value = value || '';
  }

  registerOnChange(fn: (value: string) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  protected onInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.value = input.value;
    this.onChange(this.value);
  }

  protected onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    this.fileSelected.emit(file);
    // Reset input
    input.value = '';
  }

  protected onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    
    const isValid = this.isValidFile(event.dataTransfer);
    if (isValid && !this.isDragging()) {
      this.isDragging.set(true);
      this.dragStateChange.emit(true);
    }
  }

  protected onDragLeave(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    
    if (this.isDragging()) {
      this.isDragging.set(false);
      this.dragStateChange.emit(false);
    }
  }

  protected onDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging.set(false);
    this.dragStateChange.emit(false);

    const file = event.dataTransfer?.files[0];
    if (file && this.isValidFile(event.dataTransfer)) {
      this.fileSelected.emit(file);
    }
  }

  protected openFilePicker(event?: Event): void {
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
    
    // Fallback: use ViewChild
    if (this.fileInput?.nativeElement) {
      this.fileInput.nativeElement.click();
    }
  }

  // Private callbacks for ControlValueAccessor
  private onChange: (value: string) => void = () => {
    // Callback set by registerOnChange
  };
  private onTouched: () => void = () => {
    // Callback set by registerOnTouched
  };

  private isValidFile(dataTransfer: DataTransfer | null): boolean {
    switch (this.type) {
      case 'source':
        return isValidSourceFile(dataTransfer);
      case 'audio':
        return isValidAudioFile(dataTransfer);
      case 'image':
        return isValidImageFile(dataTransfer);
      default:
        return false;
    }
  }
}

