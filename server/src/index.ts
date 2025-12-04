import cors from 'cors';
import express from 'express';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { promises as fsp } from 'fs';
import { v4 as uuid } from 'uuid';
import { spawn } from 'child_process';
import { z } from 'zod';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import https from 'https';
import http from 'http';

const app = express();
const PORT = Number(process.env.PORT ?? 4000);
const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR ?? path.join(process.cwd(), 'output'));
const MIN_TRANSCODE_SEGMENT_SECONDS = Number(
  process.env.MIN_TRANSCODE_SEGMENT_SECONDS ?? 0.35
);
const TRANSCODE_PRESET = process.env.FFMPEG_PRESET ?? 'veryfast';
const TRANSCODE_CRF = process.env.FFMPEG_CRF ?? '20';
const TRANSCODE_AUDIO_BITRATE = process.env.FFMPEG_AUDIO_BITRATE ?? '192k';

// MPD Transcoding Restrictions (configurable via environment variables)
const ENABLE_MPD_RESTRICTIONS = process.env.ENABLE_MPD_RESTRICTIONS === 'true'; // Default: false
const MAX_VIDEO_DURATION_SECONDS = Number(process.env.MAX_VIDEO_DURATION_SECONDS ?? 3600); // Default: 1 hour
const MAX_VIDEO_WIDTH = Number(process.env.MAX_VIDEO_WIDTH ?? 1920); // Default: 1080p width
const MAX_VIDEO_HEIGHT = Number(process.env.MAX_VIDEO_HEIGHT ?? 1080); // Default: 1080p height
const TRANSCODE_TIMEOUT_MS = Number(process.env.TRANSCODE_TIMEOUT_MS ?? 7200000); // Default: 2 hours
const MAX_TEMP_FILE_SIZE_MB = Number(process.env.MAX_TEMP_FILE_SIZE_MB ?? 5000); // Default: 5GB

// MPD Quality Settings (use higher quality for initial transcode to minimize double-encoding loss)
// For multi-source: Use near-lossless to preserve quality through re-encode
const MPD_TRANSCODE_CRF_MULTI = process.env.MPD_TRANSCODE_CRF_MULTI ?? '10'; // Default: 10 (near-lossless for multi-source)
const MPD_TRANSCODE_CRF_SINGLE = process.env.MPD_TRANSCODE_CRF_SINGLE ?? '18'; // Default: 18 (good quality for single-source)
const MPD_TRANSCODE_PRESET = process.env.MPD_TRANSCODE_PRESET ?? 'medium'; // Default: medium (balanced speed/quality)

const textOverlaySchema = z.object({
  id: z.number(),
  type: z.literal('text'),
  text: z.string(),
  start: z.number().min(0),
  end: z.number().positive(),
  x: z.number().min(0).max(100),
  y: z.number().min(0).max(100),
  fontSize: z.number().positive().optional(),
  fontColor: z.string().optional(),
  backgroundColor: z.string().optional(),
  opacity: z.number().min(0).max(1).optional()
});

const imageOverlaySchema = z.object({
  id: z.number(),
  type: z.literal('image'),
  imageUrl: z.string().url(),
  start: z.number().min(0),
  end: z.number().positive(),
  x: z.number().min(0).max(100), // percentage
  y: z.number().min(0).max(100), // percentage
  width: z.number().min(1).max(10000).optional(), // pixels
  height: z.number().min(1).max(10000).optional(), // pixels
  opacity: z.number().min(0).max(1).optional()
});

const shapeOverlaySchema = z.object({
  id: z.number(),
  type: z.literal('shape'),
  shapeType: z.literal('rectangle'),
  start: z.number().min(0),
  end: z.number().positive(),
  x: z.number().min(0).max(100), // percentage
  y: z.number().min(0).max(100), // percentage
  width: z.number().min(1).max(10000).optional(), // pixels
  height: z.number().min(1).max(10000).optional(), // pixels
  color: z.string().optional(),
  strokeWidth: z.number().min(1).max(20).optional(),
  fill: z.boolean().optional(),
  opacity: z.number().min(0).max(1).optional()
});

const overlaySchema = z.discriminatedUnion('type', [textOverlaySchema, imageOverlaySchema, shapeOverlaySchema]);

const sourceSchema = z.object({
  url: z.string().url(),
  type: z.enum(['video', 'image']),
  duration: z.number().min(0.1).optional() // For images, custom duration in seconds
});

const requestSchema = z.object({
  sources: z.array(sourceSchema).min(1),
  // Legacy support for single sourceUrl
  sourceUrl: z.string().url().optional(),
  trimStart: z.number().min(0),
  trimEnd: z.number().positive(),
  cuts: z
    .array(
      z.object({
        start: z.number().min(0),
        end: z.number().positive()
      })
    )
    .default([]),
  overlays: z.array(overlaySchema).default([]),
  format: z.enum(['mp4']).default('mp4')
});

type RenderRequest = z.infer<typeof requestSchema>;
type TimeRange = { start: number; end: number };

app.use(
  cors({
    origin: process.env.CORS_ORIGIN?.split(',') ?? true
  })
);
app.use(express.json({ limit: '2mb' }));
app.use('/output', express.static(OUTPUT_DIR));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', outputDir: OUTPUT_DIR });
});

app.post('/api/render', async (req, res) => {
  const parsed = requestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid payload', details: parsed.error.flatten() });
  }
  const body = parsed.data;
  
  // Convert legacy sourceUrl to sources array
  const sources = body.sources || (body.sourceUrl ? [{ url: body.sourceUrl, type: 'video' as const }] : []);
  
  if (sources.length === 0) {
    return res.status(400).json({ error: 'At least one source is required' });
  }
  
  if (body.trimStart >= body.trimEnd) {
    return res.status(400).json({ error: 'trimStart must be before trimEnd' });
  }

  const keepSegments = buildKeepSegments(body);
  if (keepSegments.length === 0) {
    return res.status(400).json({ error: 'No video content would remain after trimming/cuts' });
  }

  const jobId = uuid();
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), `video-job-${jobId}-`));
  const segmentPaths: string[] = [];
  
  // Store concatenated source if multiple sources are provided
  let sourceUrl = sources[0]?.url || '';
  let needsCleanupSingleSource = false;
  
  // Track if MPD sources are present to use better quality settings throughout
  const hasMpdSource = sources.some(s => s.url.toLowerCase().endsWith('.mpd'));
  const hasMp4Source = sources.some(s => !s.url.toLowerCase().endsWith('.mpd') && s.type === 'video');
  
  // Warn about mixing MPD and MP4
  if (hasMpdSource && hasMp4Source && sources.length > 1) {
    console.warn(`\n⚠️  ================================================`);
    console.warn(`⚠️  WARNING: Mixing MPD and MP4 sources detected!`);
    console.warn(`⚠️  This requires multiple encoding passes which may`);
    console.warn(`⚠️  reduce video quality, especially for the MPD content.`);
    console.warn(`⚠️  For best quality, use sources of the same format.`);
    console.warn(`⚠️  ================================================\n`);
  }

  // Calculate total duration for progress tracking
  const totalDuration = keepSegments.reduce((sum, seg) => sum + (seg.end - seg.start), 0);
  // Weight segment extraction at 70% and concatenation at 30% of total work
  const segmentWorkWeight = 0.7;
  const concatWorkWeight = 0.3;
  const weightedTotal = totalDuration * segmentWorkWeight + totalDuration * concatWorkWeight;

  // Shared progress state for unified percentage display
  let lastDisplayedProgress = 0;

  try {
    await ensureDir(OUTPUT_DIR);

    console.log(`[${jobId}] Starting render with ${sources.length} source(s): ${keepSegments.length} segment(s), total duration: ${totalDuration.toFixed(2)}s`);
    process.stdout.write(`\r[${jobId}] Progress: 1%`);
    lastDisplayedProgress = 1;

    // If multiple sources, concatenate them first
    if (sources.length > 1) {
      console.log(`[${jobId}] Concatenating ${sources.length} sources...`);
      const concatListPath = path.join(tempDir, 'concat-list.txt');
      const concatenatedPath = path.join(tempDir, 'concatenated.mp4');
      
      // Download all sources first
      const sourcePaths: string[] = [];
      for (const [index, source] of sources.entries()) {
        const sourcePath = path.join(tempDir, `source-${index}.mp4`);
        console.log(`[${jobId}] Processing source ${index + 1}/${sources.length}...`);
        
        if (source.type === 'image') {
          // For images, create a video from the image with custom duration
          // Add silent audio track to match video sources
          const imageDuration = source.duration || 5; // Default to 5 seconds if not specified
          const imagePath = sourcePath.replace('.mp4', '.jpg');
          await downloadFile(source.url, imagePath);
          console.log(`[${jobId}] Converting image to video (${imageDuration}s)...`);
          await runFfmpeg([
            '-hide_banner',
            '-y',
            '-loop', '1',
            '-i', imagePath,
            '-f', 'lavfi',
            '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
            '-c:v', 'libx264',
            '-t', String(imageDuration),
            '-pix_fmt', 'yuv420p',
            '-r', '25', // Match MPD transcode framerate
            '-vsync', 'cfr',
            '-c:a', 'aac',
            '-b:a', TRANSCODE_AUDIO_BITRATE, // Use same audio bitrate
            '-ar', '44100', // Match audio sample rate
            '-ac', '2', // Stereo
            '-shortest',
            sourcePath
          ]);
        } else if (source.url.toLowerCase().endsWith('.mpd')) {
          // For MPD (MPEG-DASH) files, validate and transcode to MP4
          console.log(`[${jobId}] Processing MPD stream: ${source.url}`);
          
          // Validate against restrictions (if enabled)
          await validateMpdRestrictions(source.url);
          
          // Use near-lossless CRF for multi-source to preserve quality through re-encode
          const mpdCrf = MPD_TRANSCODE_CRF_MULTI;
          console.log(`[${jobId}] Transcoding MPD stream to MP4 (CRF ${mpdCrf} near-lossless for multi-source)...`);
          await runFfmpegWithTimeout([
            '-hide_banner',
            '-y',
            '-i', source.url,
            '-c:v', 'libx264',
            '-preset', MPD_TRANSCODE_PRESET,
            '-crf', mpdCrf, // Use near-lossless CRF for multi-source
            '-r', '25', // Normalize framerate
            '-pix_fmt', 'yuv420p',
            '-vsync', 'cfr', // Constant frame rate
            '-c:a', 'aac',
            '-b:a', TRANSCODE_AUDIO_BITRATE,
            '-ar', '44100', // Normalize audio sample rate
            '-ac', '2', // Stereo
            '-movflags', '+faststart',
            sourcePath
          ], ENABLE_MPD_RESTRICTIONS ? TRANSCODE_TIMEOUT_MS : 0);
          
          // Check file size (if restrictions enabled)
          if (ENABLE_MPD_RESTRICTIONS) {
            const stats = await fsp.stat(sourcePath);
            const sizeMB = stats.size / (1024 * 1024);
            if (sizeMB > MAX_TEMP_FILE_SIZE_MB) {
              await fsp.unlink(sourcePath);
              throw new Error(
                `Transcoded MPD file size (${Math.round(sizeMB)}MB) exceeds maximum allowed (${MAX_TEMP_FILE_SIZE_MB}MB)`
              );
            }
            console.log(`[${jobId}] MPD transcoded successfully (${Math.round(sizeMB)}MB)`);
          } else {
            console.log(`[${jobId}] MPD transcoded successfully`);
          }
        } else {
          // Regular MP4 or other video file
          await downloadFile(source.url, sourcePath);
        }
        
        sourcePaths.push(sourcePath);
      }
      
      // Create concat list file with absolute paths
      // Escape single quotes and wrap paths in quotes for FFmpeg
      const concatLines = sourcePaths.map(p => {
        // Convert Windows backslashes to forward slashes for FFmpeg
        const normalizedPath = p.replace(/\\/g, '/');
        // Escape single quotes in the path
        const escapedPath = normalizedPath.replace(/'/g, "'\\''");
        return `file '${escapedPath}'`;
      }).join('\n');
      await fsp.writeFile(concatListPath, concatLines, 'utf-8');
      
      // Check if any source is an image (converted to video)
      const hasImageSource = sources.some(s => s.type === 'image');
      const needsReencode = hasMpdSource || (hasImageSource && sources.length > 1);
      
      // Concatenate all sources
      console.log(`[${jobId}] Concatenating sources...`);
      
      if (needsReencode) {
        // When MPD or mixed sources are present, re-encode to ensure compatibility
        // This ensures all sources have matching codec parameters (framerate, resolution, etc.)
        // Use higher quality settings for MPD content to preserve near-lossless intermediate quality
        const concatPreset = hasMpdSource ? 'medium' : TRANSCODE_PRESET;
        const concatCrf = hasMpdSource ? '18' : TRANSCODE_CRF; // Use CRF 18 for MPD to preserve quality
        console.log(`[${jobId}] Mixed source types detected - re-encoding for compatibility (CRF ${concatCrf}, ${concatPreset})...`);
        await runFfmpeg([
          '-hide_banner',
          '-y',
          '-f', 'concat',
          '-safe', '0',
          '-fflags', '+genpts', // Regenerate timestamps
          '-i', concatListPath,
          '-c:v', 'libx264',
          '-preset', concatPreset,
          '-crf', concatCrf,
          '-r', '25', // Normalize framerate to 25fps
          '-pix_fmt', 'yuv420p',
          '-vsync', 'cfr', // Constant frame rate
          '-c:a', 'aac',
          '-b:a', TRANSCODE_AUDIO_BITRATE,
          '-ar', '44100', // Normalize audio sample rate
          '-ac', '2', // Stereo audio
          '-movflags', '+faststart',
          concatenatedPath
        ]);
      } else {
        // All regular video files with compatible codecs - use stream copy for speed
        await runFfmpeg([
          '-hide_banner',
          '-y',
          '-f', 'concat',
          '-safe', '0',
          '-fflags', '+genpts',
          '-i', concatListPath,
          '-c', 'copy',
          concatenatedPath
        ]);
      }
      
      sourceUrl = concatenatedPath;
      console.log(`[${jobId}] Sources concatenated successfully`);
    } else if (sources.length === 1 && sources[0] && sources[0].url.toLowerCase().endsWith('.mpd')) {
      // Single MPD source - validate and transcode to MP4 first
      console.log(`[${jobId}] Processing single MPD source: ${sources[0].url}`);
      
      // Validate against restrictions (if enabled)
      await validateMpdRestrictions(sources[0].url);
      
      console.log(`[${jobId}] Transcoding single MPD source to MP4...`);
      const transcodedPath = path.join(tempDir, 'transcoded.mp4');
      const mpdCrf = MPD_TRANSCODE_CRF_SINGLE; // Use regular quality for single source (no re-encode)
      console.log(`[${jobId}] Using CRF ${mpdCrf} for single-source MPD...`);
      await runFfmpegWithTimeout([
        '-hide_banner',
        '-y',
        '-i', sources[0].url,
        '-c:v', 'libx264',
        '-preset', MPD_TRANSCODE_PRESET,
        '-crf', mpdCrf, // Use single-source CRF
        '-r', '25', // Normalize framerate
        '-pix_fmt', 'yuv420p',
        '-vsync', 'cfr', // Constant frame rate
        '-c:a', 'aac',
        '-b:a', TRANSCODE_AUDIO_BITRATE,
        '-ar', '44100', // Normalize audio sample rate
        '-ac', '2', // Stereo
        '-movflags', '+faststart',
        transcodedPath
      ], ENABLE_MPD_RESTRICTIONS ? TRANSCODE_TIMEOUT_MS : 0);
      
      // Check file size (if restrictions enabled)
      if (ENABLE_MPD_RESTRICTIONS) {
        const stats = await fsp.stat(transcodedPath);
        const sizeMB = stats.size / (1024 * 1024);
        if (sizeMB > MAX_TEMP_FILE_SIZE_MB) {
          await fsp.unlink(transcodedPath);
          throw new Error(
            `Transcoded MPD file size (${Math.round(sizeMB)}MB) exceeds maximum allowed (${MAX_TEMP_FILE_SIZE_MB}MB)`
          );
        }
        console.log(`[${jobId}] Single MPD source transcoded successfully (${Math.round(sizeMB)}MB)`);
      } else {
        console.log(`[${jobId}] Single MPD source transcoded successfully`);
      }
      
      sourceUrl = transcodedPath;
      needsCleanupSingleSource = true;
    }

    for (const [index, segment] of keepSegments.entries()) {
      const segmentPath = path.join(tempDir, `segment-${index}.mp4`);
      const duration = segment.end - segment.start;
      const segmentStartProgress = keepSegments
        .slice(0, index)
        .reduce((sum, seg) => sum + (seg.end - seg.start), 0);
      
      // Use -ss after -i for accurate seeking (output seeking)
      // This ensures precise timing even when not aligned to keyframes
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
        duration,
        segmentStartProgress * segmentWorkWeight,
        weightedTotal,
        segmentWorkWeight,
        jobId,
        (progress: number) => {
          const percentage = Math.max(1, Math.min(progress, 100));
          if (percentage > lastDisplayedProgress) {
            lastDisplayedProgress = percentage;
            process.stdout.write(`\r[${jobId}] Progress: ${percentage}%`);
          }
        }
      );
      segmentPaths.push(segmentPath);
    }

    const concatFile = path.join(tempDir, 'concat.txt');
    // Convert Windows paths to forward slashes for ffmpeg compatibility
    // and escape single quotes properly
    await fsp.writeFile(
      concatFile,
      segmentPaths
        .map(p => p.replace(/\\/g, '/').replace(/'/g, "'\\''"))
        .map(p => `file '${p}'`)
        .join('\n'),
      'utf8'
    );

    const outputFile = path.join(OUTPUT_DIR, `${jobId}.${body.format}`);
    // Always transcode when concatenating multiple segments, when overlays are present,
    // or when segments are too small for accurate stream copy
    const hasOverlays = body.overlays && body.overlays.length > 0;
    const needsTranscode =
      hasOverlays ||
      keepSegments.length > 1 ||
      keepSegments.some(segment => segment.end - segment.start < MIN_TRANSCODE_SEGMENT_SECONDS);
    
    // Download image overlays if needed
    const imageOverlayPaths: string[] = [];
    if (hasOverlays && body.overlays) {
      console.log(`[${jobId}] Downloading ${body.overlays.filter(o => o.type === 'image').length} image overlay(s)...`);
      for (const overlay of body.overlays) {
        if (overlay.type === 'image') {
          const originalExt = getImageExtension(overlay.imageUrl);
          const imagePath = path.join(tempDir, `overlay-${overlay.id}.${originalExt}`);
          try {
            await downloadFile(overlay.imageUrl, imagePath);
            // Verify file exists
            await fsp.access(imagePath);
            
            // Convert webp to PNG to avoid FFmpeg webp decoder issues
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
            return res.status(400).json({ error: `Failed to download image overlay: ${overlay.imageUrl}` });
          }
        }
      }
    }

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
    
    // Add image overlay inputs as separate -i inputs (instead of movie filter)
    // This allows us to reference them directly as [1:v], [2:v], etc.
    // Don't use -loop here - we'll handle looping in the filter chain with a duration-based loop
    if (hasOverlays && body.overlays && imageOverlayPaths.length > 0) {
      for (const imagePath of imageOverlayPaths) {
        concatArgs.push('-i', imagePath);
      }
    }

    if (needsTranscode) {
      // Build overlay filters if overlays are present
      if (hasOverlays && body.overlays && body.overlays.length > 0) {
        const { filterComplex, outputStream } = buildOverlayFilters(body.overlays, imageOverlayPaths, totalDuration);
        if (filterComplex) {
          concatArgs.push('-filter_complex', filterComplex);
          // Map the final output stream
          concatArgs.push('-map', `[${outputStream}]`);
          // Also map audio from input 0
          concatArgs.push('-map', '0:a?');
        }
      }
      
      // Use better quality settings if MPD sources are present
      const finalPreset = hasMpdSource ? 'medium' : TRANSCODE_PRESET;
      const finalCrf = hasMpdSource ? '18' : TRANSCODE_CRF;
      
      console.log(`[${jobId}] Final output quality: CRF ${finalCrf}, Preset ${finalPreset}${hasMpdSource ? ' (MPD detected)' : ''}`);
      
      concatArgs.push(
        '-c:v',
        'libx264',
        '-preset',
        finalPreset,
        '-crf',
        finalCrf,
        '-c:a',
        'aac',
        '-b:a',
        TRANSCODE_AUDIO_BITRATE,
        '-movflags',
        '+faststart'
      );
    } else {
      // Even with copy, add flags to ensure proper timestamp handling
      concatArgs.push(
        '-c',
        'copy',
        '-avoid_negative_ts',
        'make_zero',
        '-fflags',
        '+genpts'
      );
    }

    concatArgs.push(outputFile);
    
    // For concatenation progress: if transcoding, it processes full video again
    // We'll weight segment extraction at 70% and concatenation at 30% of total work
    const segmentWorkDone = totalDuration * segmentWorkWeight;
    
    console.log(`[${jobId}] Starting concatenation/transcoding step...`);
    console.log(`[${jobId}] FFmpeg command: ${ffmpegInstaller.path} ${concatArgs.join(' ')}`);
    
    await runFfmpegWithProgress(
      concatArgs,
      totalDuration, // Duration being processed in this step
      segmentWorkDone, // Progress already completed
      weightedTotal, // Total weighted work
      concatWorkWeight,
      jobId,
      (progress: number) => {
        const percentage = Math.max(1, Math.min(progress, 100));
        if (percentage > lastDisplayedProgress) {
          lastDisplayedProgress = percentage;
          process.stdout.write(`\r[${jobId}] Progress: ${percentage}%`);
        }
      }
    );
    
    console.log(`[${jobId}] Concatenation/transcoding completed`    );
    
    console.log(`[${jobId}] FFmpeg concatenation completed, verifying output file...`);
    
    // Wait a bit for file to be fully written, then verify
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Verify output file exists and has content before responding
    let retries = 10;
    while (retries > 0) {
      try {
        const stats = await fsp.stat(outputFile);
        if (stats.size > 0) {
          console.log(`[${jobId}] Output file verified: ${outputFile} (${stats.size} bytes)`);
          break;
        } else {
          console.log(`[${jobId}] Output file exists but is empty, waiting...`);
          await new Promise(resolve => setTimeout(resolve, 500));
          retries--;
        }
      } catch (error) {
        if (retries === 0) {
          console.error(`[${jobId}] Output file verification failed:`, error);
          throw new Error(`Output file was not created: ${outputFile}`);
        }
        console.log(`[${jobId}] Output file not ready yet, waiting... (${retries} retries left)`);
        await new Promise(resolve => setTimeout(resolve, 500));
        retries--;
      }
    }
    
    // Ensure we show 100% when complete (only after file is verified)
    if (lastDisplayedProgress < 100) {
      lastDisplayedProgress = 100;
      process.stdout.write(`\r[${jobId}] Progress: 100%`);
    }
    
    // Clear progress line and show completion
    process.stdout.write('\r' + ' '.repeat(80) + '\r');
    console.log(`[${jobId}] Progress: 100% - Done`);
    console.log(`[${jobId}] Sending response...`);

    const publicPath = `/output/${path.basename(outputFile)}`;
    const response: any = {
      jobId,
      outputFile: publicPath,
      segments: keepSegments,
      transcoded: needsTranscode
    };
    
    // Add warning if mixing MPD and MP4
    if (hasMpdSource && hasMp4Source && sources.length > 1) {
      response.warning = 'Quality loss may occur when mixing MPD and MP4 sources due to multiple encoding passes. For best quality, use sources of the same format.';
    }
    
    console.log(`[${jobId}] Response prepared, sending...`);
    return res.json(response);
  } catch (error) {
    console.error('[render:error]', error);
    return res.status(500).json({ error: 'Failed to render video', details: String(error) });
  } finally {
    await removeDir(tempDir);
  }
});

app.listen(PORT, () => {
  console.log(`Video edit server listening on http://localhost:${PORT}`);
  console.log(`Output files will be written to: ${OUTPUT_DIR}`);
  console.log(`\nMPD Transcoding Settings:`);
  console.log(`  - Multi-source: CRF ${MPD_TRANSCODE_CRF_MULTI} (near-lossless), Preset: ${MPD_TRANSCODE_PRESET}`);
  console.log(`  - Single-source: CRF ${MPD_TRANSCODE_CRF_SINGLE}, Preset: ${MPD_TRANSCODE_PRESET}`);
  console.log(`  - Restrictions: ${ENABLE_MPD_RESTRICTIONS ? 'ENABLED' : 'DISABLED'}`);
  if (ENABLE_MPD_RESTRICTIONS) {
    console.log(`    - Max video duration: ${MAX_VIDEO_DURATION_SECONDS}s (${Math.round(MAX_VIDEO_DURATION_SECONDS / 60)} minutes)`);
    console.log(`    - Max video resolution: ${MAX_VIDEO_WIDTH}x${MAX_VIDEO_HEIGHT}`);
    console.log(`    - Transcode timeout: ${TRANSCODE_TIMEOUT_MS / 1000}s (${Math.round(TRANSCODE_TIMEOUT_MS / 60000)} minutes)`);
    console.log(`    - Max temp file size: ${MAX_TEMP_FILE_SIZE_MB}MB`);
  }
  console.log(`\nRegular Encoding: CRF ${TRANSCODE_CRF}, Preset: ${TRANSCODE_PRESET}`);
});

function buildKeepSegments(body: RenderRequest): TimeRange[] {
  const sortedCuts = [...body.cuts]
    .filter(cut => cut.end - cut.start > 0.05)
    .map(cut => ({
      start: clamp(cut.start, body.trimStart, body.trimEnd),
      end: clamp(cut.end, body.trimStart, body.trimEnd)
    }))
    .filter(cut => cut.start < cut.end)
    .sort((a, b) => a.start - b.start);

  const segments: TimeRange[] = [];
  let cursor = body.trimStart;

  for (const cut of sortedCuts) {
    if (cut.start > cursor) {
      segments.push({ start: cursor, end: Math.min(cut.start, body.trimEnd) });
    }
    cursor = Math.max(cursor, cut.end);
    if (cursor >= body.trimEnd) {
      break;
    }
  }

  if (cursor < body.trimEnd) {
    segments.push({ start: cursor, end: body.trimEnd });
  }

  return segments.filter(segment => segment.end - segment.start > 0.05);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function hexToRgb(hex: string, opacity: number): string {
  // Remove # if present and validate
  hex = hex.replace(/^#/, '');
  
  // Validate hex format
  if (!/^[0-9A-Fa-f]{6}$/.test(hex)) {
    console.warn(`Invalid hex color: ${hex}, using default FF0000`);
    hex = 'FF0000';
  }
  
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  
  // FFmpeg format: 0xRRGGBB or 0xRRGGBBAA
  if (opacity < 1) {
    const a = Math.round(Math.max(0, Math.min(1, opacity)) * 255);
    return `0x${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}${a.toString(16).padStart(2, '0')}`;
  }
  return `0x${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

async function ensureDir(dir: string): Promise<void> {
  await fsp.mkdir(dir, { recursive: true });
}

async function removeDir(dir: string): Promise<void> {
  if (!dir || !fs.existsSync(dir)) {
    return;
  }
  await fsp.rm(dir, { recursive: true, force: true });
}

/**
 * Probe MPD stream metadata using ffprobe
 */
async function probeMpdMetadata(url: string): Promise<{ duration: number; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    // Use ffprobe (bundled with ffmpeg-installer)
    const ffprobePath = ffmpegInstaller.path.replace('ffmpeg', 'ffprobe');
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
        const videoStream = data.streams?.find((s: any) => s.width && s.height);
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
 * Validate MPD stream against restrictions (if enabled)
 */
async function validateMpdRestrictions(url: string): Promise<void> {
  if (!ENABLE_MPD_RESTRICTIONS) {
    return; // Restrictions disabled
  }

  console.log(`[validateMpdRestrictions] Checking restrictions for: ${url}`);

  try {
    const metadata = await probeMpdMetadata(url);
    console.log(`[validateMpdRestrictions] Metadata: duration=${metadata.duration}s, resolution=${metadata.width}x${metadata.height}`);

    // Check duration
    if (metadata.duration > MAX_VIDEO_DURATION_SECONDS) {
      throw new Error(
        `MPD stream duration (${Math.round(metadata.duration)}s) exceeds maximum allowed (${MAX_VIDEO_DURATION_SECONDS}s)`
      );
    }

    // Check resolution
    if (metadata.width > MAX_VIDEO_WIDTH || metadata.height > MAX_VIDEO_HEIGHT) {
      throw new Error(
        `MPD stream resolution (${metadata.width}x${metadata.height}) exceeds maximum allowed (${MAX_VIDEO_WIDTH}x${MAX_VIDEO_HEIGHT})`
      );
    }

    console.log(`[validateMpdRestrictions] Validation passed`);
  } catch (err) {
    throw new Error(`MPD validation failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
  }
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const ffmpegPath = ffmpegInstaller.path;
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
 * Run FFmpeg with optional timeout (for MPD transcoding)
 * @param args FFmpeg arguments
 * @param timeoutMs Timeout in milliseconds (0 = no timeout)
 */
function runFfmpegWithTimeout(args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const ffmpegPath = ffmpegInstaller.path;
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
      if (isTimedOut) return; // Already handled by timeout
      
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`ffmpeg exited with code ${code}`));
      }
    });
  });
}

function parseTime(timeStr: string): number {
  // Parse time in format HH:MM:SS.mmm or MM:SS.mmm
  const parts = timeStr.trim().split(':');
  if (parts.length === 3) {
    const hours = parseFloat(parts[0] ?? '0') || 0;
    const minutes = parseFloat(parts[1] ?? '0') || 0;
    const seconds = parseFloat(parts[2] ?? '0') || 0;
    return hours * 3600 + minutes * 60 + seconds;
  } else if (parts.length === 2) {
    const minutes = parseFloat(parts[0] ?? '0') || 0;
    const seconds = parseFloat(parts[1] ?? '0') || 0;
    return minutes * 60 + seconds;
  }
  return parseFloat(timeStr) || 0;
}

function runFfmpegWithProgress(
  args: string[],
  duration: number,
  baseProgress: number,
  weightedTotal: number,
  workWeight: number,
  jobId: string,
  onProgress: (percentage: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const ffmpegPath = ffmpegInstaller.path;
    console.log(`[${jobId}] Spawning FFmpeg process...`);
    const child = spawn(ffmpegPath, args, {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let lastProgress = -1;
    let errorOutput = '';
    let hasSeenProgress = false;
    // Match time in format HH:MM:SS.mmm or MM:SS.mmm
    const timeRegex = /time=(\d{1,2}:\d{2}:\d{2}\.\d{2}|\d{1,2}:\d{2}\.\d{2})/;

    child.stderr?.on('data', (data: Buffer) => {
      const output = data.toString();
      errorOutput += output;
      lastOutputTime = Date.now(); // Update last output time
      
      // Log all stderr output for debugging (but filter out common noise)
      if (output.trim() && 
          !output.includes('Fontconfig') && 
          !output.includes('time=') && 
          !output.includes('frame=') &&
          !output.includes('fps=') &&
          !output.includes('bitrate=') &&
          !output.includes('speed=') &&
          !output.includes('size=')) {
        console.log(`[${jobId}] FFmpeg stderr: ${output.trim()}`);
      }
      
      // Log errors and warnings immediately (but not fontconfig warnings which are harmless)
      if ((output.includes('error') || output.includes('Error') || output.includes('failed')) && !output.includes('Fontconfig')) {
        console.error(`[${jobId}] FFmpeg error output: ${output.trim()}`);
      }
      
      const match = output.match(timeRegex);
      
      if (match && match[1] && duration > 0) {
        hasSeenProgress = true;
        const currentTime = parseTime(match[1]);
        const segmentProgress = Math.min(currentTime / duration, 1);
        // Calculate overall progress: baseProgress is already weighted, add this segment's weighted progress
        const segmentWeightedDuration = duration * workWeight;
        const overallProgress = (baseProgress + segmentProgress * segmentWeightedDuration) / weightedTotal;
        const percentage = Math.min(Math.round(overallProgress * 100), 100);
        
        // Cap at 99% to avoid showing 100% before process actually completes
        const cappedPercentage = Math.min(percentage, 99);
        
        if (cappedPercentage !== lastProgress && cappedPercentage >= 1) {
          lastProgress = cappedPercentage;
          onProgress(cappedPercentage);
        }
      }
      
      // Log when we see "frame=" to track if FFmpeg is still processing
      if (output.includes('frame=')) {
        const frameMatch = output.match(/frame=\s*(\d+)/);
        if (frameMatch && frameMatch[1]) {
          // Log every 100 frames to track progress without spamming
          const frameNum = parseInt(frameMatch[1], 10);
          if (frameNum % 100 === 0) {
            console.log(`[${jobId}] FFmpeg processing frame ${frameNum}...`);
          }
        }
      }
      
      // Check for completion indicators
      if (output.includes('video:') && output.includes('audio:') && output.includes('kB time=')) {
        console.log(`[${jobId}] FFmpeg appears to be finalizing output...`);
      }
    });
    
    child.stdout?.on('data', (data: Buffer) => {
      // Log stdout for debugging
      const output = data.toString();
      if (output.trim()) {
        console.log(`[${jobId}] FFmpeg stdout: ${output.trim()}`);
      }
    });
    
    // Add a timeout to detect hanging processes
    // Also add a heartbeat to log if FFmpeg is still alive but not producing output
    let lastOutputTime = Date.now();
    const processStartTime = Date.now();
    const heartbeatInterval = setInterval(() => {
      const timeSinceLastOutput = Date.now() - lastOutputTime;
      const totalTime = Date.now() - processStartTime;
      if (timeSinceLastOutput > 30000 && !child.killed) { // 30 seconds without output
        // Check if process is actually still running by checking if it has a PID
        const isRunning = child.killed === false && child.exitCode === null;
        console.warn(`[${jobId}] FFmpeg has not produced output for ${Math.round(timeSinceLastOutput / 1000)}s (total: ${Math.round(totalTime / 1000)}s), process running: ${isRunning}`);
        console.warn(`[${jobId}] Last stderr: ${errorOutput.slice(-500)}`);
        if (totalTime > 300000) { // 5 minutes total
          console.error(`[${jobId}] FFmpeg has been running for 5+ minutes without completion - likely hung`);
        }
      }
    }, 10000); // Check every 10 seconds
    
    const timeout = setTimeout(() => {
      clearInterval(heartbeatInterval);
      if (!child.killed) {
        console.error(`[${jobId}] FFmpeg process timeout after 5 minutes - killing process`);
        console.error(`[${jobId}] Last stderr output: ${errorOutput.slice(-1000)}`);
        child.kill('SIGKILL');
        reject(new Error(`FFmpeg process timed out after 5 minutes. Last output: ${errorOutput.slice(-500)}`));
      }
    }, 5 * 60 * 1000); // 5 minute timeout

    child.on('error', (err) => {
      clearTimeout(timeout);
      clearInterval(heartbeatInterval);
      console.error(`[${jobId}] FFmpeg spawn error:`, err);
      reject(err);
    });
    child.on('exit', code => {
      clearTimeout(timeout);
      clearInterval(heartbeatInterval);
      console.log(`[${jobId}] FFmpeg process exited with code ${code}`);
      if (code === 0) {
        // When FFmpeg completes, show 100% progress
        onProgress(100);
        if (!hasSeenProgress && duration > 0) {
          console.warn(`[${jobId}] Warning: No progress updates seen during FFmpeg operation`);
          // If no progress was seen, log the full stderr to see what happened
          console.log(`[${jobId}] Full stderr output: ${errorOutput.slice(-2000)}`);
        }
        console.log(`[${jobId}] FFmpeg completed successfully, resolving promise`);
        resolve();
      } else {
        // Extract error message from stderr (usually the last few lines contain the actual error)
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

async function downloadFile(url: string, outputPath: string, timeoutMs: number = 300000): Promise<void> {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(outputPath);
    
    // Set timeout for download operations (default: 5 minutes)
    const timeoutId = setTimeout(() => {
      file.close();
      fs.unlink(outputPath, () => {});
      reject(new Error(`Download timeout after ${timeoutMs}ms: ${url}`));
    }, timeoutMs);
    
    const cleanup = () => {
      clearTimeout(timeoutId);
    };
    
    protocol.get(url, response => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        // Handle redirects (limit depth implicitly by call stack)
        cleanup();
        file.close();
        fs.unlink(outputPath, () => {});
        return downloadFile(response.headers.location, outputPath, timeoutMs).then(resolve).catch(reject);
      }
      
      if (!response.statusCode || (response.statusCode !== 200 && response.statusCode < 300)) {
        cleanup();
        file.close();
        fs.unlink(outputPath, () => {});
        reject(new Error(`Failed to download ${url}: ${response.statusCode || 'unknown'}`));
        return;
      }
      
      response.pipe(file);
      file.on('finish', () => {
        cleanup();
        file.close();
        resolve();
      });
      file.on('error', err => {
        cleanup();
        file.close();
        fs.unlink(outputPath, () => {});
        reject(err);
      });
    }).on('error', err => {
      cleanup();
      file.close();
      fs.unlink(outputPath, () => {});
      reject(err);
    });
  });
}

function getImageExtension(url: string): string {
  // Remove query parameters
  const cleanUrl = url.split('?')[0] || url;
  const match = cleanUrl.match(/\.(jpg|jpeg|png|gif|webp|bmp)$/i);
  return match && match[1] ? match[1].toLowerCase() : 'png';
}

async function convertWebpToPng(inputPath: string, outputPath: string, jobId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ffmpegPath = ffmpegInstaller.path;
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
        const errorLines = errorOutput.split('\n').filter(line => 
          line.trim() && 
          !line.includes('time=') && 
          !line.includes('frame=') &&
          !line.includes('fps=')
        );
        const lastError = errorLines.slice(-5).join('\n') || errorOutput.slice(-500);
        reject(new Error(`Failed to convert webp to PNG: ${lastError}`));
      }
    });
  });
}

function buildOverlayFilters(
  overlays: Array<z.infer<typeof overlaySchema>>,
  imagePaths: string[],
  videoDuration: number
): { filterComplex: string; outputStream: string } {
  if (overlays.length === 0) {
    return { filterComplex: '', outputStream: '' };
  }

  const filterParts: string[] = [];
  let imageInputIndex = 1; // Start at 1 because [0:v] is the video
  let currentStream = '[0:v]';
  
  // Sort overlays by start time for proper chaining
  const sortedOverlays = [...overlays].sort((a, b) => a.start - b.start);
  
  for (const overlay of sortedOverlays) {
    if (overlay.type === 'text') {
      const fontSize = overlay.fontSize || 24;
      const fontColor = overlay.fontColor || 'white';
      const bgColor = overlay.backgroundColor || 'black@0.5';
      const opacity = overlay.opacity ?? 1;
      // Calculate position: x and y are percentages (0-100)
      // FFmpeg drawtext: y is from TOP of video (0 = top, H = bottom)
      // Our UI uses CSS top positioning which also goes from top
      // But we need to account for text height - drawtext y is for the baseline/top of text
      const x = `W*${overlay.x}/100`;
      const y = `H*${overlay.y}/100`;
      
      console.log(`[Text Overlay Debug] Received: x=${overlay.x}%, y=${overlay.y}%, text="${overlay.text}"`);
      
      // Escape text for ffmpeg
      const escapedText = overlay.text
        .replace(/\\/g, '\\\\')
        .replace(/:/g, '\\:')
        .replace(/'/g, "\\'")
        .replace(/\[/g, '\\[')
        .replace(/\]/g, '\\]')
        .replace(/,/g, '\\,');
      
      // Enable filter only during overlay time range
      const enable = `between(t,${overlay.start},${overlay.end})`;
      const outputLabel = `v${filterParts.length + 1}`;
      
      // Check if background should be transparent
      const hasTransparentBg = !bgColor || bgColor === 'transparent' || bgColor === 'none' || bgColor === '';
      if (hasTransparentBg) {
        // No box, just text
        filterParts.push(
          `${currentStream}drawtext=text='${escapedText}':fontsize=${fontSize}:fontcolor=${fontColor}@${opacity}:x=${x}:y=${y}:enable='${enable}'[${outputLabel}]`
        );
      } else {
        // Text with background box
        filterParts.push(
          `${currentStream}drawtext=text='${escapedText}':fontsize=${fontSize}:fontcolor=${fontColor}@${opacity}:box=1:boxcolor=${bgColor}:boxborderw=5:x=${x}:y=${y}:enable='${enable}'[${outputLabel}]`
        );
      }
      currentStream = `[${outputLabel}]`;
    } else if (overlay.type === 'image' && imageInputIndex - 1 < imagePaths.length) {
      const widthPixels = overlay.width || 200;
      const heightPixels = overlay.height || 200;
      const opacity = overlay.opacity ?? 1;
      
      console.log(`[Image Overlay] id=${overlay.id}, width=${widthPixels}px, height=${heightPixels}px, x=${overlay.x}%, y=${overlay.y}%`);
      
      // Calculate position - percentages to pixels
      const x = `W*${overlay.x}/100`;
      const y = `H*${overlay.y}/100`;
      
      // Enable filter only during overlay time range
      const enable = `between(t,${overlay.start},${overlay.end})`;
      
      const imgInput = `[${imageInputIndex}:v]`; // Image is a separate input (1, 2, 3, etc.)
      const loopedImgLabel = `looped${imageInputIndex}`;
      const scaledImgLabel = `scaled${imageInputIndex}`;
      const outputLabel = `v${filterParts.length + 1}`;
      
      // Loop the image for the full video duration to ensure it's available when needed
      const loopSize = Math.ceil(videoDuration * 30); // Estimate frames needed (30 fps)
      
      // Extract stream name without brackets for scale2ref
      const currentStreamName = currentStream.replace(/^\[/, '').replace(/\]$/, '');
      
      // Scale image to exact pixel dimensions using scale filter (not scale2ref)
      // This gives us precise control over the size
      // Use force_original_aspect_ratio=decrease to maintain aspect ratio and fit within bounds
      filterParts.push(
        `${imgInput}loop=loop=-1:size=${loopSize}:start=0[${loopedImgLabel}];[${loopedImgLabel}]scale=w=${widthPixels}:h=${heightPixels}:force_original_aspect_ratio=decrease[${scaledImgLabel}];${currentStream}[${scaledImgLabel}]overlay=${x}:${y}:enable='${enable}'[${outputLabel}]`
      );
      currentStream = `[${outputLabel}]`;
      imageInputIndex++;
    } else if (overlay.type === 'shape') {
      const widthPixels = overlay.width || 200;
      const heightPixels = overlay.height || 200;
      console.log(`[Shape Overlay] id=${overlay.id}, width=${widthPixels}px, height=${heightPixels}px, x=${overlay.x}%, y=${overlay.y}%, fill=${overlay.fill || false}`);
      
      const color = overlay.color || '#FF0000';
      const strokeWidth = overlay.strokeWidth || 3;
      const fill = overlay.fill || false;
      const opacity = overlay.opacity ?? 1;
      
      // Convert hex color to RGB for FFmpeg
      const rgbColor = hexToRgb(color, opacity);
      
      // Calculate position - drawbox uses 'iw' (input width) and 'ih' (input height)
      // Position is percentage, size is pixels
      const drawboxX = `iw*${overlay.x}/100`;
      const drawboxY = `ih*${overlay.y}/100`;
      const drawboxWidth = String(widthPixels);
      const drawboxHeight = String(heightPixels);
      
      const enable = `between(t,${overlay.start},${overlay.end})`;
      const outputLabel = `v${filterParts.length + 1}`;
      
      // Rectangle shapes only
      if (fill) {
        // Filled rectangle: draw directly on video
        filterParts.push(
          `${currentStream}drawbox=x=${drawboxX}:y=${drawboxY}:w=${drawboxWidth}:h=${drawboxHeight}:color=${rgbColor}:t=-1:enable='${enable}'[${outputLabel}]`
        );
      } else {
        // Stroked rectangle: draw border
        filterParts.push(
          `${currentStream}drawbox=x=${drawboxX}:y=${drawboxY}:w=${drawboxWidth}:h=${drawboxHeight}:color=${rgbColor}:t=${strokeWidth}:enable='${enable}'[${outputLabel}]`
        );
      }
      currentStream = `[${outputLabel}]`;
    }
  }
  
  // Return the filter complex string and the final output stream label
  // currentStream is like "[v3]", we need just "v3" for the -map argument
  const finalOutputStream = currentStream.replace(/^\[|\]$/g, ''); // Remove brackets
  console.log(`[buildOverlayFilters] Final output stream: ${finalOutputStream}, filter parts: ${filterParts.length}`);
  return { filterComplex: filterParts.join(';'), outputStream: finalOutputStream };
}

