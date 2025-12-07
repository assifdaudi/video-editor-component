import { z } from 'zod';

/**
 * Zod validation schemas for render requests
 */

export const textOverlaySchema = z.object({
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

export const imageOverlaySchema = z.object({
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

export const shapeOverlaySchema = z.object({
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

export const overlaySchema = z.discriminatedUnion('type', [
  textOverlaySchema,
  imageOverlaySchema,
  shapeOverlaySchema
]);

export const sourceSchema = z.object({
  url: z.string().url(),
  type: z.enum(['video', 'image']),
  duration: z.number().min(0.1).optional() // For images, custom duration in seconds
});

export const requestSchema = z.object({
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

