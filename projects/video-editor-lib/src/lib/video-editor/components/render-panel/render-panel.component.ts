import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { RenderResponse } from '../../video-editor.types';

@Component({
  selector: 'app-render-panel',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './render-panel.component.html',
  styleUrl: './render-panel.component.scss'
})
export class RenderPanelComponent {
  @Input() canRender = false;
  @Input() renderBusy = false;
  @Input() renderResult: RenderResponse | null = null;
  @Input() exportPlan: string[] = [];
  @Input() downloadUrl: string | null = null;

  @Output() renderRequested = new EventEmitter<void>();

  protected onRender(): void {
    this.renderRequested.emit();
  }
}

