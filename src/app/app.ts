import { Component } from '@angular/core';
import { VideoEditorComponent } from '@assifdaudi/video-editor-lib';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [VideoEditorComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {}
