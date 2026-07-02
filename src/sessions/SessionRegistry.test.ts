import type { Browser, BrowserContext, Page } from 'playwright-core';
import { describe, expect, it, vi } from 'vitest';
import { BrowserProvider, type ProviderStartSessionParams } from '../providers/BrowserProvider.js';
import { SessionRegistry } from './SessionRegistry.js';
import type { StartedBrowserSession } from '../types/session.js';

const createStartedSession = (): StartedBrowserSession => ({
  browser: { close: vi.fn() } as unknown as Browser,
  context: { close: vi.fn() } as unknown as BrowserContext,
  page: { close: vi.fn() } as unknown as Page,
  providerSessionId: 'remote-1',
  metadata: { test: true },
  resolvedProviderConfig: {
    launchOptions: {},
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
  },
});

class TestProvider extends BrowserProvider {
  constructor() {
    super('playwright');
  }

  readonly startSessionMock = vi.fn(
    async (_params: ProviderStartSessionParams) => createStartedSession(),
  );
  readonly closeSessionMock = vi.fn(async (_session: StartedBrowserSession) => undefined);
  readonly saveAuthSessionMock = vi.fn(async (_session: StartedBrowserSession, name: string) => ({
    name,
    key: name,
    provider: 'playwright' as const,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    hasStorageState: true,
  }));

  async startSession(params: ProviderStartSessionParams): Promise<StartedBrowserSession> {
    return this.startSessionMock(params);
  }

  async closeSession(session: StartedBrowserSession): Promise<void> {
    await this.closeSessionMock(session);
  }

  async saveAuthSession(
    session: StartedBrowserSession,
    authSessionName: string,
  ): Promise<Awaited<ReturnType<typeof this.saveAuthSessionMock>>> {
    return this.saveAuthSessionMock(session, authSessionName);
  }
}

describe('SessionRegistry', () => {
  it('allocates sequential numeric IDs', async () => {
    const provider = new TestProvider();
    const registry = new SessionRegistry(new Map([['playwright', provider]]), 'playwright');

    const first = await registry.startSession({});
    const second = await registry.startSession({});

    expect(first.id).toBe(1);
    expect(second.id).toBe(2);
  });

  it('closes a session and removes it from the registry', async () => {
    const provider = new TestProvider();
    const registry = new SessionRegistry(new Map([['playwright', provider]]), 'playwright');
    const session = await registry.startSession({});

    await registry.closeSession(session.id);

    expect(provider.closeSessionMock).toHaveBeenCalledTimes(1);
    expect(registry.getSessions()).toHaveLength(0);
  });

  it('closes all sessions idempotently', async () => {
    const provider = new TestProvider();
    const registry = new SessionRegistry(new Map([['playwright', provider]]), 'playwright');
    await registry.startSession({});
    await registry.startSession({});

    const closedCount = await registry.closeAllSessions();
    const closedAgain = await registry.closeAllSessions();

    expect(closedCount).toBe(2);
    expect(closedAgain).toBe(0);
  });

  it('passes auth session input through and can save a named auth session', async () => {
    const provider = new TestProvider();
    const registry = new SessionRegistry(new Map([['playwright', provider]]), 'playwright');

    const session = await registry.startSession({
      authSessionName: 'mbna',
      resume: true,
    });
    const authSession = await registry.saveAuthSession(session.id, 'mbna');

    expect(provider.startSessionMock).toHaveBeenCalledWith({
      sessionName: null,
      authSessionName: 'mbna',
      resume: true,
      proxy: null,
    });
    expect(provider.saveAuthSessionMock).toHaveBeenCalledTimes(1);
    expect(authSession.name).toBe('mbna');
    expect(registry.getSessions()[0]?.authSessionName).toBe('mbna');
  });

  it('passes per-session proxy input through to the playwright provider', async () => {
    const provider = new TestProvider();
    const registry = new SessionRegistry(new Map([['playwright', provider]]), 'playwright');

    await registry.startSession({
      proxy: {
        server: 'socks5://127.0.0.1:10081',
        bypass: 'localhost,127.0.0.1,::1',
      },
    });

    expect(provider.startSessionMock).toHaveBeenCalledWith({
      sessionName: null,
      authSessionName: null,
      resume: true,
      proxy: {
        server: 'socks5://127.0.0.1:10081',
        bypass: 'localhost,127.0.0.1,::1',
      },
    });
  });

  it('rejects per-session proxy input for non-playwright providers', async () => {
    class BrowserbaseTestProvider extends BrowserProvider {
      constructor() {
        super('browserbase');
      }

      async startSession(_params: ProviderStartSessionParams): Promise<StartedBrowserSession> {
        return createStartedSession();
      }

      async closeSession(_session: StartedBrowserSession): Promise<void> {
        return undefined;
      }
    }

    const provider = new BrowserbaseTestProvider();
    const registry = new SessionRegistry(new Map([['browserbase', provider]]), 'browserbase');

    await expect(
      registry.startSession({
        proxy: {
          server: 'socks5://127.0.0.1:10081',
        },
      }),
    ).rejects.toThrow('Per-session proxy settings are currently supported only by the playwright provider');
  });

  it('saves bound auth sessions before shutdown close when configured', async () => {
    const provider = new TestProvider();
    const registry = new SessionRegistry(new Map([['playwright', provider]]), 'playwright');

    await registry.startSession({ authSessionName: 'wealthsimple' });
    await registry.closeAllSessions({ reason: 'shutdown' });

    expect(provider.saveAuthSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({ authSessionName: 'wealthsimple' }),
      'wealthsimple',
    );
    expect(provider.closeSessionMock).toHaveBeenCalledTimes(1);
  });
});
