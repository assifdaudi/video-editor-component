import { Router, type Request, type Response } from 'express';
import { requestSchema } from '../validators/render-request.validator';
import { renderVideo } from '../services/video-processor.service';

/**
 * Render API routes
 */

export const renderRouter = Router();

/**
 * POST /api/render
 * Render a video with sources, trims, cuts, and overlays
 */
renderRouter.post('/render', async (req: Request, res: Response) => {
  try {
    // Validate request
    const parsed = requestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ 
        error: 'Invalid payload', 
        details: parsed.error.flatten() 
      });
    }
    
    // Process video
    const result = await renderVideo(parsed.data, (progress, jobId) => {
      process.stdout.write(`\r[${jobId}] Progress: ${progress}%`);
    });
    
    return res.json(result);
    
  } catch (error) {
    console.error('[Render Error]', error);
    return res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Internal server error' 
    });
  }
});

