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
    
    // Prepare audio sources
    const { audioPaths, hasAudio } = await prepareAudioSources(
      request.audioSources || [],
      tempDir,
      jobId,
      totalDuration,
      onProgress
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
      audioPaths,
      hasAudio,
      request.audioMixMode || 'mix',
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
 * Prepare audio sources (download and process)
 */
async function prepareAudioSources(
  audioSources: RenderRequest['audioSources'],
  tempDir: string,
  jobId: string,
  totalDuration: number,
  _onProgress?: (progress: number, jobId: string) => void
): Promise<{ audioPaths: Array<{ path: string; startTime: number; volume: number }>; hasAudio: boolean }> {
  if (!audioSources || audioSources.length === 0) {
    return { audioPaths: [], hasAudio: false };
  }

  // Filter out muted audio and handle solo
  const hasSolo = audioSources.some(a => a.solo);
  const activeAudio = audioSources.filter(a => {
    if (hasSolo) {
      return a.solo && !a.muted;
    }
    return !a.muted;
  });

  if (activeAudio.length === 0) {
    return { audioPaths: [], hasAudio: false };
  }

  console.log(`[${jobId}] Processing ${activeAudio.length} audio source(s)...`);

  const audioPaths: Array<{ path: string; startTime: number; volume: number }> = [];

  for (const [index, audio] of activeAudio.entries()) {
    try {
      // Download audio file
      const audioExt = path.extname(new URL(audio.url).pathname) || '.mp3';
      const audioPath = path.join(tempDir, `audio-${index}${audioExt}`);
      
      console.log(`[${jobId}] Downloading audio ${index + 1}/${activeAudio.length}: ${audio.url}`);
      await downloadFile(audio.url, audioPath);
      await fsp.access(audioPath);

      let finalAudioPath = audioPath;
      const audioTrimStart = audio.audioTrimStart ?? 0;
      const audioTrimEnd = audio.audioTrimEnd ?? audio.originalDuration ?? audio.duration;
      const audioTrimDuration = audioTrimEnd - audioTrimStart;

      // Calculate timeline trim duration (if audio extends beyond video duration)
      const audioEndTime = audio.startTime + audio.duration;
      const needsTimelineTrim = audioEndTime > totalDuration;
      const timelineTrimDuration = needsTimelineTrim ? totalDuration - audio.startTime : null;
      
      if (needsTimelineTrim && timelineTrimDuration !== null && timelineTrimDuration <= 0) {
        // Audio starts after video ends, skip it
        continue;
      }

      // Determine what processing is needed
      const needsTrim = audioTrimStart > 0 || audioTrimEnd < (audio.originalDuration ?? audio.duration);
      const needsVolume = audio.volume !== 1.0;
      const needsProcessing = needsTrim || needsVolume || needsTimelineTrim;

      // If we need any processing, do it all in one FFmpeg pass
      if (needsProcessing) {
        // Use .m4a extension for AAC output (more reliable than .mp3)
        const processedPath = path.join(tempDir, `audio-${index}-processed.m4a`);
        const ffmpegArgs = [
          '-hide_banner',
          '-y',
          '-i', audioPath
        ];

        // Always explicitly map the first audio stream first
        ffmpegArgs.push('-map', '0:a:0');

        // Seek to trim start (audio file trim) - put after input for better accuracy
        if (audioTrimStart > 0) {
          ffmpegArgs.push('-ss', audioTrimStart.toFixed(3));
        }

        // Duration to extract (use the smaller of trim duration or timeline trim duration)
        const extractDuration = needsTimelineTrim && timelineTrimDuration !== null 
          ? Math.min(timelineTrimDuration, audioTrimDuration)
          : audioTrimDuration;
        ffmpegArgs.push('-t', extractDuration.toFixed(3));

        // Build filter chain
        const filters: string[] = [];
        
        // Apply volume if needed
        if (needsVolume) {
          filters.push(`volume=${audio.volume.toFixed(3)}`);
        }

        // Apply filters if any (use -af instead of -filter:a for consistency)
        if (filters.length > 0) {
          ffmpegArgs.push('-af', filters.join(','));
        }

        // Always encode to AAC with explicit parameters
        ffmpegArgs.push(
          '-c:a', 'aac',
          '-b:a', '192k',
          '-ar', '44100', // Explicit sample rate
          '-ac', '2', // Explicit stereo
          processedPath
        );

        await runFfmpegWithProgress(
          ffmpegArgs,
          jobId,
          () => {},
          extractDuration
        );
        finalAudioPath = processedPath;
        
        if (needsTrim) {
          console.log(`[${jobId}] Trimmed audio: ${audioTrimStart.toFixed(3)}s - ${audioTrimEnd.toFixed(3)}s`);
        }
        if (needsTimelineTrim) {
          console.log(`[${jobId}] Timeline trimmed audio to fit video duration`);
        }
      }

      audioPaths.push({
        path: finalAudioPath,
        startTime: audio.startTime,
        volume: audio.volume
      });

      console.log(`[${jobId}] Processed audio ${index + 1}/${activeAudio.length}: start=${audio.startTime}s, duration=${audio.duration}s, volume=${audio.volume}`);
    } catch (error) {
      console.error(`[${jobId}] Failed to process audio ${audio.url}:`, error);
      throw new Error(`Failed to process audio: ${audio.url}`);
    }
  }

  return { audioPaths, hasAudio: audioPaths.length > 0 };
}

/**
 * Final render with concatenation, overlays, and audio
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
  audioPaths: Array<{ path: string; startTime: number; volume: number }>,
  hasAudio: boolean,
  audioMixMode: 'mix' | 'replace',
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
  
  // Add audio inputs
  if (hasAudio && audioPaths.length > 0) {
    for (const audio of audioPaths) {
      concatArgs.push('-i', audio.path);
    }
  }

  if (needsTranscode || hasAudio) {
    const filterParts: string[] = [];
    let videoStream = '[0:v]';
    let audioStreams: string[] = [];
    let nextStreamIndex = 1;
    let needsVideoFilter = false;

    // Build overlay filters
    if (hasOverlays && overlays && overlays.length > 0) {
      const { filterComplex, outputStream } = buildOverlayFilters(overlays, imageOverlayPaths, totalDuration);
      if (filterComplex) {
        filterParts.push(filterComplex);
        videoStream = `[${outputStream}]`;
        nextStreamIndex = imageOverlayPaths.length + 1;
        needsVideoFilter = true;
      }
    }

    // Handle audio mixing
    if (hasAudio && audioPaths.length > 0) {
      // Video audio is always from input 0 (the concat input)
      const videoAudioStream = '[0:a]';
      const audioInputStartIndex = hasOverlays && imageOverlayPaths.length > 0 
        ? imageOverlayPaths.length + 1 
        : 1;

      if (audioMixMode === 'replace') {
        // Replace video audio with mixed audio tracks
        if (audioPaths.length === 1) {
          // Single audio track - delay and use directly
          const audio = audioPaths[0]!;
          const delay = audio.startTime;
          filterParts.push(
            `[${audioInputStartIndex}:a]adelay=${Math.round(delay * 1000)}|${Math.round(delay * 1000)}[a0]`
          );
          audioStreams.push('[a0]');
        } else {
          // Multiple audio tracks - delay each and mix
          audioPaths.forEach((audio, index) => {
            const delay = audio.startTime;
            filterParts.push(
              `[${audioInputStartIndex + index}:a]adelay=${Math.round(delay * 1000)}|${Math.round(delay * 1000)}[a${index}]`
            );
            audioStreams.push(`[a${index}]`);
          });
          
          // Mix all audio tracks
          if (audioStreams.length > 1) {
            const mixInputs = audioStreams.join('');
            filterParts.push(`${mixInputs}amix=inputs=${audioStreams.length}:duration=longest[amixed]`);
            audioStreams = ['[amixed]'];
          }
        }
      } else {
        // Mix mode - combine video audio with additional audio tracks
        // Add delayed audio tracks first
        audioPaths.forEach((audio, index) => {
          const delay = audio.startTime;
          filterParts.push(
            `[${audioInputStartIndex + index}:a]adelay=${Math.round(delay * 1000)}|${Math.round(delay * 1000)}[a${index}]`
          );
          audioStreams.push(`[a${index}]`);
        });
        
        // Add video audio to the mix
        audioStreams.push(videoAudioStream);
        
        // Mix video audio with additional audio tracks
        if (audioStreams.length > 1) {
          const mixInputs = audioStreams.join('');
          filterParts.push(`${mixInputs}amix=inputs=${audioStreams.length}:duration=longest[amixed]`);
          audioStreams = ['[amixed]'];
        } else {
          // Only video audio
          audioStreams = [videoAudioStream];
        }
      }
    } else {
      // No additional audio - use video audio if available
      audioStreams.push('[0:a]');
    }

    // If we have audio filters but no video filter, we need to add a passthrough for video
    if (filterParts.length > 0 && !needsVideoFilter) {
      filterParts.unshift(`[0:v]null[vout]`);
      videoStream = '[vout]';
    }

    // Build filter_complex
    if (filterParts.length > 0) {
      concatArgs.push('-filter_complex', filterParts.join(';'));
      
      // Map video and audio from filter outputs
      concatArgs.push('-map', videoStream);
      if (audioStreams.length > 0 && audioStreams[0]) {
        concatArgs.push('-map', audioStreams[0]);
      }
    } else {
      // No filters needed, map directly from inputs
      concatArgs.push('-map', '0:v');
      concatArgs.push('-map', '0:a?');
    }
    
    const hasMpdSource = sources.some(s => isMpdUrl(s.url));
    const finalPreset = hasMpdSource ? 'medium' : serverConfig.transcodePreset;
    const finalCrf = hasMpdSource ? '18' : serverConfig.transcodeCrf;
    
    console.log(`[${jobId}] Final output quality: CRF ${finalCrf}, Preset ${finalPreset}${hasMpdSource ? ' (MPD detected)' : ''}`);
    if (hasAudio) {
      console.log(`[${jobId}] Audio mode: ${audioMixMode}, ${audioPaths.length} track(s)`);
    }
    
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

