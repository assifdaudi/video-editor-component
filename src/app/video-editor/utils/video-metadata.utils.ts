import * as dashjs from 'dashjs';

/**
 * Get duration of a video by loading its metadata
 */
export function getVideoDuration(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';

    const isMpd = url.toLowerCase().endsWith('.mpd');

    if (isMpd) {
      // Use dash.js for MPD files
      const player = dashjs.MediaPlayer().create();

      const timeout = setTimeout(() => {
        player.reset();
        reject(new Error('Timeout loading MPD metadata (10s)'));
      }, 10000); // 10 second timeout

      // Dash.js fires 'canPlay' when stream is ready
      const onCanPlay = (): void => {
        clearTimeout(timeout);
        const duration = video.duration;

        if (duration && !isNaN(duration) && isFinite(duration) && duration > 0) {
          player.reset();
          resolve(duration);
        } else {
          player.reset();
          reject(new Error(`Could not determine video duration from MPD (got ${duration})`));
        }
      };

      const onStreamInitialized = (): void => {
        // Sometimes duration is available after stream initialization
        if (video.duration && !isNaN(video.duration) && isFinite(video.duration) && video.duration > 0) {
          clearTimeout(timeout);
          player.reset();
          resolve(video.duration);
        }
      };

      const onError = (e: { error?: string }): void => {
        clearTimeout(timeout);
        player.reset();
        reject(new Error(`Failed to load MPD metadata: ${e.error || 'Unknown error'}`));
      };

      const onManifestLoaded = (e: { data?: { mediaPresentationDuration?: number } }): void => {
        // The manifest might contain duration info
        if (e && e.data && e.data.mediaPresentationDuration) {
          clearTimeout(timeout);
          player.reset();
          resolve(e.data.mediaPresentationDuration);
        }
      };

      // Listen to dash.js events
      player.on(dashjs.MediaPlayer.events.CAN_PLAY, onCanPlay);
      player.on(dashjs.MediaPlayer.events.STREAM_INITIALIZED, onStreamInitialized);
      player.on(dashjs.MediaPlayer.events.ERROR, onError);
      player.on(dashjs.MediaPlayer.events.MANIFEST_LOADED, onManifestLoaded);

      // Also listen to video element events as fallback
      video.addEventListener('loadedmetadata', () => {
        if (video.duration && !isNaN(video.duration) && isFinite(video.duration) && video.duration > 0) {
          clearTimeout(timeout);
          player.reset();
          resolve(video.duration);
        }
      }, { once: true });

      // Initialize the player
      player.initialize(video, url, false);
    } else {
      // Regular MP4 or other video format
      video.addEventListener('loadedmetadata', () => {
        if (video.duration && !isNaN(video.duration) && isFinite(video.duration)) {
          resolve(video.duration);
        } else {
          reject(new Error('Could not determine video duration'));
        }
        video.src = '';
      });

      video.addEventListener('error', () => {
        reject(new Error('Failed to load video metadata'));
        video.src = '';
      });

      video.src = url;
    }
  });
}

/**
 * Get duration of an audio file by loading its metadata
 */
export function getAudioDuration(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const audio = new Audio();
    audio.preload = 'metadata';

    audio.addEventListener('loadedmetadata', () => {
      resolve(audio.duration);
      audio.src = '';
    });

    audio.addEventListener('error', () => {
      reject(new Error('Failed to load audio metadata'));
      audio.src = '';
    });

    audio.src = url;
  });
}

