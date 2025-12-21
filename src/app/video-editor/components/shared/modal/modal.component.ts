import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output, signal, effect } from '@angular/core';

@Component({
  selector: 'app-modal',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './modal.component.html',
  styleUrl: './modal.component.scss'
})
export class ModalComponent {
  @Input() isOpen = false;
  @Input() title = '';
  @Input() showCloseButton = true;
  
  @Output() closed = new EventEmitter<void>();

  protected readonly isOpenSignal = signal(false);

  constructor() {
    effect(() => {
      this.isOpenSignal.set(this.isOpen);
    });
  }

  protected onBackdropClick(): void {
    this.close();
  }

  protected onContentClick(event: Event): void {
    event.stopPropagation();
  }

  protected onClose(): void {
    this.close();
  }

  protected onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape' || event.key === 'Enter') {
      event.preventDefault();
      this.close();
    }
  }

  private close(): void {
    this.closed.emit();
  }
}

