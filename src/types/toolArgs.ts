import { z } from 'zod';
import { providerNameSchema } from './providerConfig.js';

export const startSessionSchema = z.object({
  provider: providerNameSchema.optional(),
  sessionName: z.string().min(1).max(100).optional(),
});

export const closeSessionSchema = z.object({
  sessionId: z.number().int().positive(),
});

export const sessionIdSchema = z.object({
  sessionId: z.number().int().positive(),
});

export const selectorSchema = sessionIdSchema.extend({
  selector: z.string().min(1),
  timeout: z.number().int().positive().optional(),
});

export const navigateSchema = sessionIdSchema.extend({
  url: z.string().url(),
});

export const fillSchema = selectorSchema.extend({
  value: z.string(),
});

export const fillFormSchema = sessionIdSchema.extend({
  fields: z.array(
    z.object({
      selector: z.string().min(1),
      value: z.string(),
    }),
  ),
});

export const screenshotSchema = sessionIdSchema.extend({
  fullPage: z.boolean().optional().describe('Capture full scrollable page, not just the viewport.'),
});

export const snapshotSchema = sessionIdSchema.extend({
  maxDepth: z.number().int().positive().optional().describe('Max tree depth (default 4).'),
  maxChildren: z.number().int().positive().optional().describe('Max children per node (default 20).'),
  selector: z.string().min(1).optional().describe('Scope to an element; omit for document body.'),
});

export const domQuerySchema = sessionIdSchema.extend({
  selector: z.string().min(1),
});

export const dragSchema = sessionIdSchema.extend({
  sourceSelector: z.string().min(1),
  targetSelector: z.string().min(1),
  timeout: z.number().int().positive().optional(),
});

export const selectOptionSchema = sessionIdSchema.extend({
  selector: z.string().min(1),
  values: z.array(z.string().min(1)).min(1).describe('Option values to select; pass multiple for multi-select.'),
  timeout: z.number().int().positive().optional(),
});

export const generateLocatorSchema = sessionIdSchema.extend({
  selector: z.string().min(1),
});

export const evaluateSchema = sessionIdSchema.extend({
  script: z.string().min(1),
  selector: z.string().min(1).optional().describe('Matched element passed as first arg to script.'),
});

export const keyboardPressSchema = sessionIdSchema.extend({
  key: z.string().min(1).describe('Playwright key name, e.g. "Enter", "ArrowDown", "Control+A".'),
});

export const keyboardTypeSchema = sessionIdSchema.extend({
  text: z.string(),
  delay: z.number().int().nonnegative().optional().describe('Ms between keystrokes. Omit for instant.'),
});

export const mousePointSchema = sessionIdSchema.extend({
  x: z.number(),
  y: z.number(),
});

export const mouseDragSchema = sessionIdSchema.extend({
  startX: z.number(),
  startY: z.number(),
  endX: z.number(),
  endY: z.number(),
});

export const uploadFileSchema = sessionIdSchema.extend({
  selector: z.string().min(1),
  filePaths: z.array(z.string().min(1)).min(1),
});

export const waitForSelectorSchema = sessionIdSchema.extend({
  selector: z.string().min(1),
  state: z.enum(['attached', 'detached', 'visible', 'hidden']).optional(),
  timeout: z.number().int().positive().optional(),
});

export const waitForTimeoutSchema = sessionIdSchema.extend({
  milliseconds: z.number().int().nonnegative(),
});
