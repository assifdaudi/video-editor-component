import path from 'path';
import { promises as fsp } from 'fs';
import { downloadFile, getImageExtension } from '../utils/file.utils';
import { runFfmpeg, runFfmpegWithTimeout, convertWebpToPng } from '../utils/ffmpeg.utils';
import { validateMpdRestrictions, isMpdUrl } from '../utils/video.utils';
import { serverConfig, mpdConfig } from '../utils/config.utils';
import type { VideoSource } from '../types';

/**
 * Source handler service - processes and concatenates video sources
 */

export interface ProcessedSource {
  sourcePath: string;
  needsTranscode: boolean;
}

/**
 * Process a single video source (download, convert, or transcode)
 */
export async function processSingleSource(
  source: VideoSource,
  index: number,
  totalSources: number,
  tempDir: string,
  jobId: string,
  isMultiSource: boolean
): Promise<ProcessedSource> {
  const sourcePath = path.join(tempDir, `source-${index}.mp4`);
  let needsTranscode = false;
  
  console.log(`[${jobId}] Processing source ${index + 1}/${totalSources}...`);
  
  if (source.type === 'image') {
    await processImageSource(source, sourcePath, tempDir, jobId);
    needsTranscode = true;
  } else if (isMpdUrl(source.url)) {
    await processMpdSource(source, sourcePath, jobId, isMultiSource);
    needsTranscode = true;
  } else {
    await downloadFile(source.url, sourcePath);
  }
  
  return { sourcePath, needsTranscode };
}

/**
 * Process an image source - convert to video
 */
async function processImageSource(
  source: VideoSource,
  sourcePath: string,
  tempDir: string,
  jobId: string
): Promise<void> {
  const imageDuration = source.duration || 5;
  const ext = getImageExtension(source.url);
  const imagePath = path.join(tempDir, `image-${Date.now()}.${ext}`);
  
  await downloadFile(source.url, imagePath);
  
  // Convert WebP to PNG if needed
  let finalImagePath = imagePath;
  if (ext === 'webp') {
    const pngPath = imagePath.replace('.webp', '.png');
    console.log(`[${jobId}] Converting WebP to PNG...`);
    await convertWebpToPng(imagePath, pngPath, jobId);
    finalImagePath = pngPath;
  }
  
  console.log(`[${jobId}] Converting image to video (${imageDuration}s)...`);
  await runFfmpeg([
    '-hide_banner',
    '-y',
    '-loop', '1',
    '-i', finalImagePath,
    '-f', 'lavfi',
    '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
    '-c:v', 'libx264',
    '-t', String(imageDuration),
    '-pix_fmt', 'yuv420p',
    '-r', '25',
    '-vsync', 'cfr',
    '-c:a', 'aac',
    '-b:a', serverConfig.transcodeAudioBitrate,
    '-ar', '44100',
    '-ac', '2',
    '-shortest',
    sourcePath
  ]);
}

/**
 * Process an MPD source - validate and transcode
 */
async function processMpdSource(
  source: VideoSource,
  sourcePath: string,
  jobId: string,
  isMultiSource: boolean
): Promise<void> {
  console.log(`[${jobId}] Processing MPD stream: ${source.url}`);
  
  await validateMpdRestrictions(source.url);
  
  const mpdCrf = isMultiSource ? mpdConfig.transcodeCrfMulti : mpdConfig.transcodeCrfSingle;
  console.log(`[${jobId}] Transcoding MPD stream to MP4 (CRF ${mpdCrf})...`);
  
  await runFfmpegWithTimeout([
    '-hide_banner',
    '-y',
    '-i', source.url,
    '-c:v', 'libx264',
    '-preset', mpdConfig.transcodePreset,
    '-crf', mpdCrf,
    '-r', '25',
    '-pix_fmt', 'yuv420p',
    '-vsync', 'cfr',
    '-c:a', 'aac',
    '-b:a', serverConfig.transcodeAudioBitrate,
    '-ar', '44100',
    '-ac', '2',
    '-movflags', '+faststart',
    sourcePath
  ], mpdConfig.enableRestrictions ? mpdConfig.transcodeTimeoutMs : 0);
  
  if (mpdConfig.enableRestrictions) {
    const stats = await fsp.stat(sourcePath);
    const sizeMB = stats.size / (1024 * 1024);
    if (sizeMB > mpdConfig.maxTempFileSizeMb) {
      await fsp.unlink(sourcePath);
      throw new Error(
        `Transcoded MPD file size (${Math.round(sizeMB)}MB) exceeds maximum allowed (${mpdConfig.maxTempFileSizeMb}MB)`
      );
    }
    console.log(`[${jobId}] MPD transcoded successfully (${Math.round(sizeMB)}MB)`);
  } else {
    console.log(`[${jobId}] MPD transcoded successfully`);
  }
}

/**
 * Concatenate multiple sources into a single video
 */
export async function concatenateSources(
  sources: VideoSource[],
  sourcePaths: string[],
  tempDir: string,
  jobId: string,
  hasMpdSource: boolean,
  hasImageSource: boolean
): Promise<string> {
  const concatListPath = path.join(tempDir, 'concat-list.txt');
  const concatenatedPath = path.join(tempDir, 'concatenated.mp4');
  
  // Create concat list file
  const concatLines = sourcePaths.map(p => {
    const normalizedPath = p.replace(/\\/g, '/');
    const escapedPath = normalizedPath.replace(/'/g, "'\\''");
    return `file '${escapedPath}'`;
  }).join('\n');
  await fsp.writeFile(concatListPath, concatLines, 'utf-8');
  
  const needsReencode = hasMpdSource || (hasImageSource && sources.length > 1);
  
  console.log(`[${jobId}] Concatenating sources...`);
  
  if (needsReencode) {
    const concatPreset = hasMpdSource ? 'medium' : serverConfig.transcodePreset;
    const concatCrf = hasMpdSource ? '18' : serverConfig.transcodeCrf;
    console.log(`[${jobId}] Mixed source types detected - re-encoding for compatibility (CRF ${concatCrf}, ${concatPreset})...`);
    
    await runFfmpeg([
      '-hide_banner',
      '-y',
      '-f', 'concat',
      '-safe', '0',
      '-fflags', '+genpts',
      '-i', concatListPath,
      '-c:v', 'libx264',
      '-preset', concatPreset,
      '-crf', concatCrf,
      '-r', '25',
      '-pix_fmt', 'yuv420p',
      '-vsync', 'cfr',
      '-c:a', 'aac',
      '-b:a', serverConfig.transcodeAudioBitrate,
      '-ar', '44100',
      '-ac', '2',
      '-movflags', '+faststart',
      concatenatedPath
    ]);
  } else {
    await runFfmpeg([
      '-hide_banner',
      '-y',
      '-f', 'concat',
      '-safe', '0',
      '-i', concatListPath,
      '-c', 'copy',
      concatenatedPath
    ]);
  }
  
  return concatenatedPath;
}

/**
 * Check for quality warnings when mixing source formats
 */
export function checkQualityWarnings(sources: VideoSource[]): string | undefined {
  const hasMpdSource = sources.some(s => isMpdUrl(s.url));
  const hasMp4Source = sources.some(s => !isMpdUrl(s.url) && s.type === 'video');
  
  if (hasMpdSource && hasMp4Source && sources.length > 1) {
    console.warn(`\n⚠️  ================================================`);
    console.warn(`⚠️  WARNING: Mixing MPD and MP4 sources detected!`);
    console.warn(`⚠️  This requires multiple encoding passes which may`);
    console.warn(`⚠️  reduce video quality, especially for the MPD content.`);
    console.warn(`⚠️  For best quality, use sources of the same format.`);
    console.warn(`⚠️  ================================================\n`);
    return 'Mixing MPD and MP4 sources may reduce quality due to multiple encoding passes';
  }
  
  return undefined;
}

