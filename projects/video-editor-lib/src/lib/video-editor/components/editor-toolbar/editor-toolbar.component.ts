import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
  selector: 'app-editor-toolbar',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './editor-toolbar.component.html',
  styleUrl: './editor-toolbar.component.scss'
})
export class EditorToolbarComponent {
  @Input() timelineMode: 'cut' | 'keep' = 'cut';

  @Output() modeToggle = new EventEmitter<void>();
  @Output() openOverlayForm = new EventEmitter<void>();
  @Output() openAudioForm = new EventEmitter<void>();
  @Output() openCutForm = new EventEmitter<void>();

  protected onModeToggle(): void {
    this.modeToggle.emit();
  }

  protected onOpenOverlayForm(): void {
    this.openOverlayForm.emit();
  }

  protected onOpenAudioForm(): void {
    this.openAudioForm.emit();
  }

  protected onOpenCutForm(): void {
    this.openCutForm.emit();
  }
}

