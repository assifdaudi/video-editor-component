/**
 * Configuration and environment variables
 */

export interface ServerConfig {
  port: number;
  outputDir: string;
  minTranscodeSegmentSeconds: number;
  transcodePreset: string;
  transcodeCrf: string;
  transcodeAudioBitrate: string;
}

export interface MpdConfig {
  enableRestrictions: boolean;
  maxVideoDurationSeconds: number;
  maxVideoWidth: number;
  maxVideoHeight: number;
  transcodeTimeoutMs: number;
  maxTempFileSizeMb: number;
  transcodeCrfMulti: string;
  transcodeCrfSingle: string;
  transcodePreset: string;
}

