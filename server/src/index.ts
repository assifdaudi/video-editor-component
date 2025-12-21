import cors from 'cors';
import express from 'express';
import { serverConfig } from './utils/config.utils';
import { renderRouter } from './routes/render.routes';
import { uploadRouter } from './routes/upload.routes';
import { promises as fsp } from 'fs';

/**
 * Main server application
 */

const app = express();

// Middleware
app.use(
  cors({
    origin: process.env.CORS_ORIGIN?.split(',') ?? true
  })
);
app.use(express.json({ limit: '2mb' }));
app.use('/output', express.static(serverConfig.outputDir));
// Serve uploads directory
app.use('/output/uploads', express.static(serverConfig.outputDir + '/uploads'));

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', outputDir: serverConfig.outputDir });
});

// API routes
app.use('/api', renderRouter);
app.use('/api', uploadRouter);

// Ensure output directory exists
async function ensureOutputDir(): Promise<void> {
  try {
    await fsp.mkdir(serverConfig.outputDir, { recursive: true });
    // Also ensure uploads directory exists
    await fsp.mkdir(serverConfig.outputDir + '/uploads', { recursive: true });
  } catch (err) {
    console.error('Failed to create output directory:', err);
  }
}

// Start server
async function startServer(): Promise<void> {
  await ensureOutputDir();
  
  app.listen(serverConfig.port, () => {
    console.log(`✓ Server listening on port ${serverConfig.port}`);
    console.log(`✓ Output directory: ${serverConfig.outputDir}`);
    console.log(`✓ Ready to process videos`);
  });
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

