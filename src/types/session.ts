import type { Browser, BrowserContext, Page } from 'playwright-core';
import type {
  ProviderName,
  SessionProxyConfig,
} from './providerConfig.js';
import type {
  ResolvedAnchorProviderConfig,
  ResolvedBrowserbaseProviderConfig,
  ResolvedCloudflareProviderConfig,
  ResolvedPlaywrightProviderConfig,
} from '../config/serverConfig.js';

export interface StartSessionInput {
  provider?: ProviderName;
  sessionName?: string;
  authSessionName?: string;
  resume?: boolean;
  proxy?: SessionProxyConfig;
}

export interface StartedBrowserSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  providerSessionId: string | null;
  metadata: Record<string, unknown>;
  resolvedProviderConfig:
    | ResolvedBrowserbaseProviderConfig
    | ResolvedAnchorProviderConfig
    | ResolvedPlaywrightProviderConfig
    | ResolvedCloudflareProviderConfig;
}

export interface SessionRecord extends StartedBrowserSession {
  id: number;
  provider: ProviderName;
  sessionName: string | null;
  authSessionName: string | null;
  createdAt: string;
  lastUsedAt: string;
}

export interface SessionSummary {
  id: number;
  provider: ProviderName;
  providerSessionId: string | null;
  sessionName: string | null;
  authSessionName: string | null;
  createdAt: string;
  lastUsedAt: string;
  metadata: Record<string, unknown>;
  resolvedProviderConfig:
    | ResolvedBrowserbaseProviderConfig
    | ResolvedAnchorProviderConfig
    | ResolvedPlaywrightProviderConfig
    | ResolvedCloudflareProviderConfig;
}

export interface SessionToolContext {
  sessionId: number;
}

export interface AuthSessionSummary {
  name: string;
  key: string;
  provider: ProviderName;
  createdAt: string | null;
  updatedAt: string | null;
  hasStorageState: boolean;
}
