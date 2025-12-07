import path from 'path';
import type { ServerConfig, MpdConfig } from '../types';

/**
 * Server configuration from environment variables
 */
export const serverConfig: ServerConfig = {
  port: Number(process.env.PORT ?? 4000),
  outputDir: path.resolve(process.env.OUTPUT_DIR ?? path.join(process.cwd(), 'output')),
  minTranscodeSegmentSeconds: Number(process.env.MIN_TRANSCODE_SEGMENT_SECONDS ?? 0.35),
  transcodePreset: process.env.FFMPEG_PRESET ?? 'veryfast',
  transcodeCrf: process.env.FFMPEG_CRF ?? '20',
  transcodeAudioBitrate: process.env.FFMPEG_AUDIO_BITRATE ?? '192k'
};

/**
 * MPD transcoding configuration
 */
export const mpdConfig: MpdConfig = {
  enableRestrictions: process.env.ENABLE_MPD_RESTRICTIONS === 'true',
  maxVideoDurationSeconds: Number(process.env.MAX_VIDEO_DURATION_SECONDS ?? 3600),
  maxVideoWidth: Number(process.env.MAX_VIDEO_WIDTH ?? 1920),
  maxVideoHeight: Number(process.env.MAX_VIDEO_HEIGHT ?? 1080),
  transcodeTimeoutMs: Number(process.env.TRANSCODE_TIMEOUT_MS ?? 7200000),
  maxTempFileSizeMb: Number(process.env.MAX_TEMP_FILE_SIZE_MB ?? 5000),
  transcodeCrfMulti: process.env.MPD_TRANSCODE_CRF_MULTI ?? '10',
  transcodeCrfSingle: process.env.MPD_TRANSCODE_CRF_SINGLE ?? '18',
  transcodePreset: process.env.MPD_TRANSCODE_PRESET ?? 'medium'
};

