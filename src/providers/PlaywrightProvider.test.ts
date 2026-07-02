import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Browser, BrowserContext, Page } from 'playwright-core';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PlaywrightProvider } from './PlaywrightProvider.js';

const mocks = vi.hoisted(() => {
  const newPage = vi.fn(async () => ({}) as Page);
  const storageState = vi.fn(async () => undefined);
  const newContext = vi.fn(
    async () => ({ newPage, close: vi.fn(), storageState }) as unknown as BrowserContext,
  );
  const launch = vi.fn(async () => ({ newContext, close: vi.fn() }) as unknown as Browser);
  const cloakLaunch = vi.fn(
    async () => ({ newContext, close: vi.fn() }) as unknown as Browser,
  );

  return {
    newPage,
    storageState,
    newContext,
    launch,
    cloakLaunch,
  };
});

vi.mock('playwright', () => ({
  chromium: {
    launch: mocks.launch,
  },
}));

vi.mock('cloakbrowser', () => ({
  launch: mocks.cloakLaunch,
}));

describe('PlaywrightProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const createConfig = (overrides: Partial<ConstructorParameters<typeof PlaywrightProvider>[0]> = {}) => ({
    launchOptions: { headless: true },
    contextOptions: {},
    storageStatePath: null,
    executablePath: null,
    channel: null,
    useCloakBrowser: false,
    authSessionPersistence: {
      enabled: true,
      rootDir: '.playwright-mcp/auth-sessions',
      saveOnClose: true,
      saveOnShutdown: true,
    },
    ...overrides,
  });

  it('launches a local browser with resolved config', async () => {
    const provider = new PlaywrightProvider(createConfig({
      launchOptions: { headless: true },
      contextOptions: { viewport: { width: 1200, height: 800 } },
      storageStatePath: null,
      executablePath: '/path/to/chrome',
      channel: 'chrome',
      useCloakBrowser: false,
    }));

    const session = await provider.startSession({ sessionName: null });

    expect(mocks.launch).toHaveBeenCalledWith({
      headless: true,
      executablePath: '/path/to/chrome',
      channel: 'chrome',
    });
    expect(mocks.cloakLaunch).not.toHaveBeenCalled();
    expect(mocks.newContext).toHaveBeenCalledWith({
      viewport: { width: 1200, height: 800 },
    });
    expect(session.providerSessionId).toBeNull();
    expect(session.metadata).toMatchObject({ isLocal: true, stealth: false });
  });

  it('launches via cloakbrowser when useCloakBrowser is enabled', async () => {
    const provider = new PlaywrightProvider(createConfig({
      launchOptions: { headless: true },
      contextOptions: {},
      storageStatePath: null,
      executablePath: null,
      channel: null,
      useCloakBrowser: true,
    }));

    const session = await provider.startSession({ sessionName: null });

    expect(mocks.cloakLaunch).toHaveBeenCalledWith({ headless: true });
    expect(mocks.launch).not.toHaveBeenCalled();
    expect(session.metadata).toMatchObject({ isLocal: true, stealth: true });
  });

  it('applies per-session proxy settings to the browser context', async () => {
    const provider = new PlaywrightProvider(createConfig({
      launchOptions: { headless: true },
      contextOptions: { viewport: { width: 1200, height: 800 } },
    }));

    const session = await provider.startSession({
      sessionName: null,
      proxy: {
        server: 'socks5://127.0.0.1:10081',
        bypass: 'localhost,127.0.0.1,::1',
      },
    });

    expect(mocks.launch).toHaveBeenCalledWith({
      headless: true,
    });
    expect(mocks.newContext).toHaveBeenCalledWith({
      viewport: { width: 1200, height: 800 },
      proxy: {
        server: 'socks5://127.0.0.1:10081',
        bypass: 'localhost,127.0.0.1,::1',
      },
    });
    expect(session.resolvedProviderConfig).toMatchObject({
      contextOptions: {
        proxy: {
          server: 'socks5://127.0.0.1:10081',
          bypass: 'localhost,127.0.0.1,::1',
        },
      },
    });
  });

  it('loads a saved auth session storage state when present', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'parallel-browser-auth-'));
    const authDir = join(rootDir, 'website-1');
    await mkdir(authDir, { recursive: true });
    const storageStatePath = join(authDir, 'storage-state.json');
    await writeFile(storageStatePath, '{"cookies":[],"origins":[]}');

    try {
      const provider = new PlaywrightProvider(createConfig({
        authSessionPersistence: {
          enabled: true,
          rootDir,
          saveOnClose: true,
          saveOnShutdown: true,
        },
      }));

      await provider.startSession({
        sessionName: null,
        authSessionName: 'Website 1',
        resume: true,
      });

      expect(mocks.newContext).toHaveBeenCalledWith({
        storageState: storageStatePath,
      });
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('saves auth session storage state under a normalized name', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'parallel-browser-auth-'));

    try {
      const provider = new PlaywrightProvider(createConfig({
        authSessionPersistence: {
          enabled: true,
          rootDir,
          saveOnClose: true,
          saveOnShutdown: true,
        },
      }));
      const session = await provider.startSession({ sessionName: null });

      const saved = await provider.saveAuthSession(session, 'Website 1');

      expect(saved).toMatchObject({
        name: 'Website 1',
        key: 'website-1',
        provider: 'playwright',
        hasStorageState: true,
      });
      expect(mocks.storageState).toHaveBeenCalledWith({
        path: join(rootDir, 'website-1', 'storage-state.json'),
      });
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});
