import { Component } from '@angular/core';
import { VideoEditorComponent } from './video-editor/video-editor.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [VideoEditorComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {}
