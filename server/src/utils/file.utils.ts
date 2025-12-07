import fs from 'fs';
import { promises as fsp } from 'fs';
import https from 'https';
import http from 'http';
import os from 'os';
import path from 'path';

/**
 * File operations and download utilities
 */

/**
 * Create a temporary directory
 */
export async function createTempDir(prefix: string = 'render-'): Promise<string> {
  const tempDir = path.join(os.tmpdir(), `${prefix}${Date.now()}`);
  await fsp.mkdir(tempDir, { recursive: true });
  return tempDir;
}

/**
 * Remove a directory recursively
 */
export async function removeDir(dir: string): Promise<void> {
  if (!dir || !fs.existsSync(dir)) {
    return;
  }
  await fsp.rm(dir, { recursive: true, force: true });
}

/**
 * Download a file from URL
 */
export function downloadFile(url: string, outputPath: string, timeoutMs: number = 300000): Promise<void> {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(outputPath);
    
    const timeoutId = setTimeout(() => {
      file.close();
      fs.unlink(outputPath, () => {});
      reject(new Error(`Download timeout after ${timeoutMs}ms: ${url}`));
    }, timeoutMs);
    
    const cleanup = (): void => {
      clearTimeout(timeoutId);
    };
    
    protocol.get(url, response => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
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

/**
 * Get image file extension from URL
 */
export function getImageExtension(url: string): string {
  const cleanUrl = url.split('?')[0] || url;
  const match = cleanUrl.match(/\.(jpg|jpeg|png|gif|webp|bmp)$/i);
  return match && match[1] ? match[1].toLowerCase() : 'png';
}

/**
 * Check if file size exceeds limit
 */
export async function checkFileSize(filePath: string, maxSizeMb: number): Promise<void> {
  const stats = await fsp.stat(filePath);
  const sizeMb = stats.size / (1024 * 1024);
  if (sizeMb > maxSizeMb) {
    throw new Error(`File size (${sizeMb.toFixed(2)}MB) exceeds limit (${maxSizeMb}MB)`);
  }
}

