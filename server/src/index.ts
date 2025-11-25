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

const app = express();
const PORT = Number(process.env.PORT ?? 4000);
const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR ?? path.join(process.cwd(), 'output'));
const MIN_TRANSCODE_SEGMENT_SECONDS = Number(
  process.env.MIN_TRANSCODE_SEGMENT_SECONDS ?? 0.35
);
const TRANSCODE_PRESET = process.env.FFMPEG_PRESET ?? 'veryfast';
const TRANSCODE_CRF = process.env.FFMPEG_CRF ?? '20';
const TRANSCODE_AUDIO_BITRATE = process.env.FFMPEG_AUDIO_BITRATE ?? '192k';

const requestSchema = z.object({
  sourceUrl: z.string().url(),
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

  try {
    await ensureDir(OUTPUT_DIR);

    for (const [index, segment] of keepSegments.entries()) {
      const segmentPath = path.join(tempDir, `segment-${index}.mp4`);
      await runFfmpeg([
        '-hide_banner',
        '-y',
        '-i',
        body.sourceUrl,
        '-ss',
        segment.start.toFixed(3),
        '-t',
        (segment.end - segment.start).toFixed(3),
        '-avoid_negative_ts',
        'make_zero',
        '-c',
        'copy',
        segmentPath
      ]);
      segmentPaths.push(segmentPath);
    }

    const concatFile = path.join(tempDir, 'concat.txt');
    await fsp.writeFile(
      concatFile,
      segmentPaths.map(p => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'),
      'utf8'
    );

    const outputFile = path.join(OUTPUT_DIR, `${jobId}.${body.format}`);
    const needsTranscode = keepSegments.some(
      segment => segment.end - segment.start < MIN_TRANSCODE_SEGMENT_SECONDS
    );

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

    if (needsTranscode) {
      concatArgs.push(
        '-c:v',
        'libx264',
        '-preset',
        TRANSCODE_PRESET,
        '-crf',
        TRANSCODE_CRF,
        '-c:a',
        'aac',
        '-b:a',
        TRANSCODE_AUDIO_BITRATE
      );
    } else {
      concatArgs.push('-c', 'copy');
    }

    concatArgs.push(outputFile);
    await runFfmpeg(concatArgs);

    const publicPath = `/output/${path.basename(outputFile)}`;
    return res.json({
      jobId,
      outputFile: publicPath,
      segments: keepSegments,
      transcoded: needsTranscode
    });
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

async function ensureDir(dir: string): Promise<void> {
  await fsp.mkdir(dir, { recursive: true });
}

async function removeDir(dir: string): Promise<void> {
  if (!dir || !fs.existsSync(dir)) {
    return;
  }
  await fsp.rm(dir, { recursive: true, force: true });
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

