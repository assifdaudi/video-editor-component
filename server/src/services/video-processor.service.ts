import path from 'path';
import { promises as fsp } from 'fs';
import { v4 as uuid } from 'uuid';
import { serverConfig } from '../utils/config.utils';
import { createTempDir, removeDir, downloadFile, getImageExtension } from '../utils/file.utils';
import { runFfmpegWithProgress, convertWebpToPng } from '../utils/ffmpeg.utils';
import { calculateKeepSegments, isMpdUrl } from '../utils/video.utils';
import { processSingleSource, concatenateSources, checkQualityWarnings } from './source-handler.service';
import { buildOverlayFilters } from './overlay.service';
import type { RenderRequest, RenderResponse, VideoSource, TimeRange } from '../types';

/**
 * Main video processing orchestrator
 */

/**
 * Render a video with sources, trims, cuts, and overlays
 */
export async function renderVideo(
  request: RenderRequest,
  onProgress?: (progress: number, jobId: string) => void
): Promise<RenderResponse> {
  const jobId = uuid();
  const tempDir = await createTempDir(`video-job-${jobId}-`);
  
  try {
    // Prepare sources
    const sources = request.sources || (request.sourceUrl ? [{ url: request.sourceUrl, type: 'video' as const }] : []);
    
    if (sources.length === 0) {
      throw new Error('At least one source is required');
    }
    
    if (request.trimStart >= request.trimEnd) {
      throw new Error('trimStart must be before trimEnd');
    }
    
    // Calculate segments to keep
    const keepSegments = calculateKeepSegments(request.trimStart, request.trimEnd, request.cuts);
    
    if (keepSegments.length === 0) {
      throw new Error('No video content would remain after trimming/cuts');
    }
    
    // Check for quality warnings
    const qualityWarning = checkQualityWarnings(sources);
    
    // Calculate total duration for progress
    const totalDuration = keepSegments.reduce((sum, seg) => sum + (seg.end - seg.start), 0);
    
    console.log(`[${jobId}] Starting render with ${sources.length} source(s): ${keepSegments.length} segment(s), total duration: ${totalDuration.toFixed(2)}s`);
    
    if (onProgress) onProgress(1, jobId);
    
    // Process sources
    const { sourceUrl, needsTranscodeFromSource } = await processSources(
      sources,
      tempDir,
      jobId,
      onProgress
    );
    
    // Extract segments
    const segmentPaths = await extractSegments(
      sourceUrl,
      keepSegments,
      tempDir,
      jobId,
      totalDuration,
      onProgress
    );
    
    // Prepare overlays
    const { imageOverlayPaths, hasOverlays } = await prepareOverlays(
      request.overlays,
      tempDir,
      jobId
    );
    
    // Final render
    const outputFile = await finalRender(
      segmentPaths,
      imageOverlayPaths,
      request.overlays,
      keepSegments,
      totalDuration,
      hasOverlays,
      needsTranscodeFromSource,
      sources,
      tempDir,
      jobId,
      request.format,
      onProgress
    );
    
    if (onProgress) onProgress(100, jobId);
    
    console.log(`[${jobId}] Progress: 100% - Done`);
    console.log(`[${jobId}] Sending response...`);
    
    const publicPath = `/output/${path.basename(outputFile)}`;
    return {
      jobId,
      outputFile: publicPath,
      segments: keepSegments,
      transcoded: needsTranscodeFromSource,
      warning: qualityWarning
    };
    
  } finally {
    // Cleanup
    setTimeout(() => {
      removeDir(tempDir).catch(err => 
        console.error(`[${jobId}] Failed to cleanup temp dir: ${err}`)
      );
    }, 1000);
  }
}

/**
 * Process all sources (download, convert, concatenate)
 */
async function processSources(
  sources: VideoSource[],
  tempDir: string,
  jobId: string,
  _onProgress?: (progress: number, jobId: string) => void
): Promise<{ sourceUrl: string; needsTranscodeFromSource: boolean }> {
  const hasMpdSource = sources.some(s => isMpdUrl(s.url));
  
  if (sources.length === 1) {
    // Single source
    const source = sources[0]!;
    
    if (source.type === 'image') {
      const { sourcePath } = await processSingleSource(source, 0, 1, tempDir, jobId, false);
      return { sourceUrl: sourcePath, needsTranscodeFromSource: true };
    } else if (isMpdUrl(source.url)) {
      const { sourcePath } = await processSingleSource(source, 0, 1, tempDir, jobId, false);
      return { sourceUrl: sourcePath, needsTranscodeFromSource: true };
    } else {
      return { sourceUrl: source.url, needsTranscodeFromSource: false };
    }
  } else {
    // Multiple sources - need to concatenate
    console.log(`[${jobId}] Concatenating ${sources.length} sources...`);
    
    const sourcePaths: string[] = [];
    for (const [index, source] of sources.entries()) {
      const { sourcePath } = await processSingleSource(
        source,
        index,
        sources.length,
        tempDir,
        jobId,
        true
      );
      sourcePaths.push(sourcePath);
    }
    
    const hasImageSource = sources.some(s => s.type === 'image');
    const concatenatedPath = await concatenateSources(
      sources,
      sourcePaths,
      tempDir,
      jobId,
      hasMpdSource,
      hasImageSource
    );
    
    return { sourceUrl: concatenatedPath, needsTranscodeFromSource: true };
  }
}

/**
 * Extract segments from source video
 */
async function extractSegments(
  sourceUrl: string,
  keepSegments: TimeRange[],
  tempDir: string,
  jobId: string,
  totalDuration: number,
  onProgress?: (progress: number, jobId: string) => void
): Promise<string[]> {
  const segmentPaths: string[] = [];
  
  for (const [index, segment] of keepSegments.entries()) {
    const segmentPath = path.join(tempDir, `segment-${index}.mp4`);
    const duration = segment.end - segment.start;
    
    await runFfmpegWithProgress(
      [
        '-hide_banner',
        '-y',
        '-ss',
        segment.start.toFixed(3),
        '-i',
        sourceUrl,
        '-t',
        duration.toFixed(3),
        '-avoid_negative_ts',
        'make_zero',
        '-vsync',
        'cfr',
        '-c',
        'copy',
        segmentPath
      ],
      jobId,
      (progress: number) => {
        const percentage = Math.max(1, Math.min(progress, 100));
        if (onProgress) onProgress(percentage, jobId);
      },
      totalDuration
    );
    
    segmentPaths.push(segmentPath);
  }
  
  return segmentPaths;
}

/**
 * Download and prepare image overlays
 */
async function prepareOverlays(
  overlays: RenderRequest['overlays'],
  tempDir: string,
  jobId: string
): Promise<{ imageOverlayPaths: string[]; hasOverlays: boolean }> {
  const hasOverlays = overlays && overlays.length > 0;
  const imageOverlayPaths: string[] = [];
  
  if (!hasOverlays) {
    return { imageOverlayPaths, hasOverlays: false };
  }
  
  console.log(`[${jobId}] Downloading ${overlays.filter(o => o.type === 'image').length} image overlay(s)...`);
  
  for (const overlay of overlays) {
    if (overlay.type === 'image') {
      const originalExt = getImageExtension(overlay.imageUrl);
      const imagePath = path.join(tempDir, `overlay-${overlay.id}.${originalExt}`);
      
      try {
        await downloadFile(overlay.imageUrl, imagePath);
        await fsp.access(imagePath);
        
        let finalImagePath = imagePath;
        if (originalExt === 'webp') {
          const pngPath = path.join(tempDir, `overlay-${overlay.id}.png`);
          console.log(`[${jobId}] Converting webp to PNG: ${imagePath} -> ${pngPath}`);
          await convertWebpToPng(imagePath, pngPath, jobId);
          finalImagePath = pngPath;
        }
        
        imageOverlayPaths.push(finalImagePath);
        console.log(`[${jobId}] Using image overlay: ${finalImagePath}`);
      } catch (error) {
        console.error(`[${jobId}] Failed to download/convert image overlay ${overlay.imageUrl}:`, error);
        throw new Error(`Failed to download image overlay: ${overlay.imageUrl}`);
      }
    }
  }
  
  return { imageOverlayPaths, hasOverlays: true };
}

/**
 * Final render with concatenation and overlays
 */
async function finalRender(
  segmentPaths: string[],
  imageOverlayPaths: string[],
  overlays: RenderRequest['overlays'],
  keepSegments: TimeRange[],
  totalDuration: number,
  hasOverlays: boolean,
  needsTranscodeFromSource: boolean,
  sources: VideoSource[],
  tempDir: string,
  jobId: string,
  format: string,
  onProgress?: (progress: number, jobId: string) => void
): Promise<string> {
  // Create concat list
  const concatFile = path.join(tempDir, 'concat.txt');
  await fsp.writeFile(
    concatFile,
    segmentPaths
      .map(p => p.replace(/\\/g, '/').replace(/'/g, "'\\''"))
      .map(p => `file '${p}'`)
      .join('\n'),
    'utf8'
  );
  
  const outputFile = path.join(serverConfig.outputDir, `${jobId}.${format}`);
  
  // Determine if transcoding is needed
  const needsTranscode =
    hasOverlays ||
    keepSegments.length > 1 ||
    keepSegments.some(segment => segment.end - segment.start < serverConfig.minTranscodeSegmentSeconds);
  
  const concatArgs = [
    '-hide_banner',
    '-y',
    '-f',
    'concat',
    '-safe',
    '0',
    '-fflags',
    '+genpts',
    '-i',
    concatFile
  ];
  
  // Add image overlay inputs
  if (hasOverlays && imageOverlayPaths.length > 0) {
    for (const imagePath of imageOverlayPaths) {
      concatArgs.push('-i', imagePath);
    }
  }
  
  if (needsTranscode) {
    // Build overlay filters
    if (hasOverlays && overlays && overlays.length > 0) {
      const { filterComplex, outputStream } = buildOverlayFilters(overlays, imageOverlayPaths, totalDuration);
      if (filterComplex) {
        concatArgs.push('-filter_complex', filterComplex);
        concatArgs.push('-map', `[${outputStream}]`);
        concatArgs.push('-map', '0:a?');
      }
    }
    
    const hasMpdSource = sources.some(s => isMpdUrl(s.url));
    const finalPreset = hasMpdSource ? 'medium' : serverConfig.transcodePreset;
    const finalCrf = hasMpdSource ? '18' : serverConfig.transcodeCrf;
    
    console.log(`[${jobId}] Final output quality: CRF ${finalCrf}, Preset ${finalPreset}${hasMpdSource ? ' (MPD detected)' : ''}`);
    
    concatArgs.push(
      '-c:v', 'libx264',
      '-preset', finalPreset,
      '-crf', finalCrf,
      '-c:a', 'aac',
      '-b:a', serverConfig.transcodeAudioBitrate,
      '-movflags', '+faststart',
      outputFile
    );
  } else {
    concatArgs.push('-c', 'copy', outputFile);
  }
  
  await runFfmpegWithProgress(
    concatArgs,
    jobId,
    (progress) => {
      if (onProgress) onProgress(Math.min(99, progress), jobId);
    },
    totalDuration
  );
  
  return outputFile;
}

