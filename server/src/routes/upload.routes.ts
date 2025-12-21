import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import path from 'path';
import { promises as fsp } from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { serverConfig } from '../utils/config.utils';

/**
 * Upload API routes
 */

export const uploadRouter = Router();

// Configure multer storage
const storage = multer.diskStorage({
  destination: async (_req, _file, cb) => {
    const uploadDir = path.join(serverConfig.outputDir, 'uploads');
    try {
      await fsp.mkdir(uploadDir, { recursive: true });
      cb(null, uploadDir);
    } catch (err) {
      cb(err instanceof Error ? err : new Error('Failed to create upload directory'), '');
    }
  },
  filename: (_req, file, cb) => {
    // Preserve original extension
    const ext = path.extname(file.originalname);
    const filename = `${uuidv4()}${ext}`;
    cb(null, filename);
  }
});

// Configure multer
const upload = multer({
  storage,
  limits: {
    fileSize: 500 * 1024 * 1024 // 500MB limit
  },
  fileFilter: (_req, file, cb) => {
    // Allow video, audio, and image files
    const allowedMimes = [
      'video/mp4',
      'video/x-m4v',
      'application/dash+xml', // MPD files
      'audio/mpeg',
      'audio/mp3',
      'audio/wav',
      'audio/ogg',
      'audio/aac',
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/gif',
      'image/webp'
    ];
    
    // Also check by extension for MPD files
    const ext = path.extname(file.originalname).toLowerCase();
    const isMpd = ext === '.mpd';
    
    if (allowedMimes.includes(file.mimetype) || isMpd) {
      cb(null, true);
    } else {
      cb(new Error(`File type not allowed: ${file.mimetype}. Allowed types: ${allowedMimes.join(', ')}`));
    }
  }
});

/**
 * POST /api/upload
 * Upload a file (video, audio, or image)
 */
uploadRouter.post('/upload', upload.single('file'), (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Return the URL path for the uploaded file
    const fileUrl = `/output/uploads/${req.file.filename}`;
    
    return res.json({
      success: true,
      url: fileUrl,
      filename: req.file.filename,
      originalName: req.file.originalname,
      size: req.file.size,
      mimetype: req.file.mimetype
    });
  } catch (error) {
    console.error('[Upload Error]', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Internal server error'
    });
  }
});

