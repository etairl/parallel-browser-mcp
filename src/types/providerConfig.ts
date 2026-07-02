import { z } from 'zod';

export const providerNames = ['browserbase', 'anchor', 'playwright', 'cloudflare'] as const;

export type ProviderName = (typeof providerNames)[number];

const recordSchema = z.record(z.unknown());

export const sessionProxyConfigSchema = z
  .object({
    server: z.string().min(1),
    bypass: z.string().min(1).optional(),
    username: z.string().min(1).optional(),
    password: z.string().min(1).optional(),
  })
  .strict();

export type SessionProxyConfig = z.infer<typeof sessionProxyConfigSchema>;

export const browserbaseProviderConfigSchema = z
  .object({
    projectId: z.string().min(1).nullable().optional(),
    proxy: z.union([z.boolean(), recordSchema]).nullable().optional(),
    keepAlive: z.boolean().optional(),
    contextId: z.string().min(1).nullable().optional(),
    persist: z.boolean().optional(),
    sessionOptions: recordSchema.optional(),
  })
  .strict();

export type BrowserbaseProviderConfig = z.infer<typeof browserbaseProviderConfigSchema>;

export const anchorTimeoutSchema = z
  .object({
    maxDuration: z.number().positive().optional(),
    idleTimeout: z.number().positive().optional(),
  })
  .strict();

export const anchorProviderConfigSchema = z
  .object({
    recording: z.boolean().optional(),
    proxy: recordSchema.nullable().optional(),
    timeout: anchorTimeoutSchema.nullable().optional(),
    sessionOptions: recordSchema.optional(),
  })
  .strict();

export type AnchorBrowserProviderConfig = z.infer<typeof anchorProviderConfigSchema>;

export const playwrightProviderConfigSchema = z
  .object({
    launchOptions: recordSchema.optional(),
    contextOptions: recordSchema.optional(),
    storageStatePath: z.string().min(1).nullable().optional(),
    executablePath: z.string().min(1).nullable().optional(),
    channel: z.string().min(1).nullable().optional(),
    useCloakBrowser: z.boolean().optional(),
    authSessionPersistence: z
      .object({
        enabled: z.boolean().optional(),
        rootDir: z.string().min(1).optional(),
        saveOnClose: z.boolean().optional(),
        saveOnShutdown: z.boolean().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type PlaywrightProviderConfig = z.infer<typeof playwrightProviderConfigSchema>;

export const cloudflareProviderConfigSchema = z
  .object({
    accountId: z.string().min(1).nullable().optional(),
    keepAlive: z.number().positive().nullable().optional(),
  })
  .strict();

export type CloudflareProviderConfig = z.infer<typeof cloudflareProviderConfigSchema>;

export const providerNameSchema = z.enum(providerNames);
