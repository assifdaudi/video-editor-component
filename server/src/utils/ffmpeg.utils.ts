import { spawn } from 'child_process';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import type { VideoMetadata } from '../types';

/**
 * FFmpeg and FFprobe utility functions
 */

/**
 * Get FFmpeg binary path
 */
export function getFfmpegPath(): string {
  return ffmpegInstaller.path;
}

/**
 * Get FFprobe binary path
 */
export function getFfprobePath(): string {
  return ffmpegInstaller.path.replace('ffmpeg', 'ffprobe');
}

/**
 * Run FFmpeg with given arguments
 */
export function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const ffmpegPath = getFfmpegPath();
    const child = spawn(ffmpegPath, args, { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', code => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`ffmpeg exited with code ${code}`));
      }
    });
  });
}

/**
 * Run FFmpeg with timeout
 */
export function runFfmpegWithTimeout(args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const ffmpegPath = getFfmpegPath();
    const child = spawn(ffmpegPath, args, { stdio: 'inherit' });
    
    let timeoutHandle: NodeJS.Timeout | null = null;
    let isTimedOut = false;
    
    if (timeoutMs > 0) {
      timeoutHandle = setTimeout(() => {
        isTimedOut = true;
        child.kill('SIGKILL');
        reject(new Error(`FFmpeg transcode timed out after ${timeoutMs / 1000}s`));
      }, timeoutMs);
    }
    
    child.on('error', (err) => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (!isTimedOut) reject(err);
    });
    
    child.on('exit', (code) => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (isTimedOut) return;
      
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`ffmpeg exited with code ${code}`));
      }
    });
  });
}

/**
 * Run FFmpeg with progress tracking
 */
export function runFfmpegWithProgress(
  args: string[],
  jobId: string,
  onProgress: (progress: number) => void,
  estimatedDuration: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    const ffmpegPath = getFfmpegPath();
    const child = spawn(ffmpegPath, args, {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let errorOutput = '';
    const timeRegex = /time=(\d{1,2}:\d{2}:\d{2}\.\d{2}|\d{1,2}:\d{2}\.\d{2})/;

    child.stderr?.on('data', (data: Buffer) => {
      const output = data.toString();
      errorOutput += output;
      
      const match = output.match(timeRegex);
      if (match && match[1]) {
        const current = parseTime(match[1]);
        const progress = Math.min(Math.round((current / estimatedDuration) * 100), 99);
        onProgress(progress);
      }
    });

    child.on('error', reject);
    child.on('exit', code => {
      if (code === 0) {
        resolve();
      } else {
        const errorLines = errorOutput.split('\n').filter(line => 
          line.trim() && 
          !line.includes('time=') && 
          !line.includes('frame=') &&
          !line.includes('fps=') &&
          !line.includes('bitrate=') &&
          !line.includes('speed=')
        );
        const lastError = errorLines.slice(-5).join('\n') || errorOutput.slice(-500);
        console.error(`[${jobId}] FFmpeg error details: ${errorOutput}`);
        reject(new Error(`ffmpeg exited with code ${code}\n${lastError}`));
      }
    });
  });
}

/**
 * Probe video/stream metadata using ffprobe
 */
export function probeMpdMetadata(url: string): Promise<VideoMetadata> {
  return new Promise((resolve, reject) => {
    const ffprobePath = getFfprobePath();
    const child = spawn(ffprobePath, [
      '-v', 'error',
      '-show_entries', 'format=duration:stream=width,height',
      '-of', 'json',
      url
    ], {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`ffprobe failed: ${stderr}`));
        return;
      }

      try {
        const data = JSON.parse(stdout);
        const duration = parseFloat(data.format?.duration ?? '0') || 0;
        const videoStream = data.streams?.find((s: { width?: number; height?: number }) => s.width && s.height);
        const width = videoStream?.width || 0;
        const height = videoStream?.height || 0;

        resolve({ duration, width, height });
      } catch (err) {
        reject(new Error(`Failed to parse ffprobe output: ${err}`));
      }
    });
  });
}

/**
 * Convert WebP image to PNG
 */
export function convertWebpToPng(inputPath: string, outputPath: string, _jobId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ffmpegPath = getFfmpegPath();
    const child = spawn(ffmpegPath, [
      '-hide_banner',
      '-y',
      '-i', inputPath,
      outputPath
    ], {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let errorOutput = '';
    child.stderr?.on('data', (data: Buffer) => {
      errorOutput += data.toString();
    });

    child.on('error', reject);
    child.on('exit', code => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`WebP conversion failed: ${errorOutput}`));
      }
    });
  });
}

/**
 * Parse FFmpeg time string to seconds
 */
function parseTime(timeStr: string): number {
  const parts = timeStr.trim().split(':');
  if (parts.length === 3) {
    const h = parseFloat(parts[0] || '0');
    const m = parseFloat(parts[1] || '0');
    const s = parseFloat(parts[2] || '0');
    return h * 3600 + m * 60 + s;
  } else if (parts.length === 2) {
    const m = parseFloat(parts[0] || '0');
    const s = parseFloat(parts[1] || '0');
    return m * 60 + s;
  }
  return parseFloat(timeStr) || 0;
}

