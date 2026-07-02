import type { BrowserProvider } from '../providers/BrowserProvider.js';
import type { ProviderName } from '../types/providerConfig.js';
import type {
  AuthSessionSummary,
  SessionRecord,
  SessionSummary,
  StartSessionInput,
} from '../types/session.js';

export class SessionRegistryError extends Error {}

interface CloseSessionOptions {
  reason?: 'user' | 'shutdown';
}

export class SessionRegistry {
  private readonly sessions = new Map<number, SessionRecord>();
  private nextSessionId = 1;

  constructor(
    private readonly providers: Map<ProviderName, BrowserProvider>,
    private readonly defaultProvider: ProviderName,
  ) {}

  async startSession(input: StartSessionInput): Promise<SessionSummary> {
    const providerName = input.provider ?? this.defaultProvider;
    const provider = this.providers.get(providerName);

    if (provider === undefined) {
      throw new SessionRegistryError(`Unsupported provider "${providerName}".`);
    }

    if (input.proxy !== undefined && providerName !== 'playwright') {
      throw new SessionRegistryError(
        `Per-session proxy settings are currently supported only by the playwright provider, not "${providerName}".`,
      );
    }

    const startedSession = await provider.startSession({
      sessionName: input.sessionName ?? null,
      authSessionName: input.authSessionName ?? null,
      resume: input.resume ?? true,
      proxy: input.proxy ?? null,
    });
    const now = new Date().toISOString();
    const id = this.nextSessionId;

    this.nextSessionId += 1;

    const record: SessionRecord = {
      ...startedSession,
      id,
      provider: providerName,
      sessionName: input.sessionName ?? null,
      authSessionName: input.authSessionName ?? null,
      createdAt: now,
      lastUsedAt: now,
    };

    this.sessions.set(id, record);

    return this.toSummary(record);
  }

  getSessions(): SessionSummary[] {
    return [...this.sessions.values()].map((session) => this.toSummary(session));
  }

  getSessionOrThrow(id: number): SessionRecord {
    const session = this.sessions.get(id);

    if (session === undefined) {
      throw new SessionRegistryError(
        `Unknown session ${id}. Start a session first or call get_sessions.`,
      );
    }

    session.lastUsedAt = new Date().toISOString();

    return session;
  }

  async closeSession(id: number, options: CloseSessionOptions = {}): Promise<void> {
    const session = this.getSessionOrThrow(id);
    const provider = this.providers.get(session.provider);

    if (provider === undefined) {
      throw new SessionRegistryError(`Missing provider "${session.provider}" for session ${id}.`);
    }

    await this.saveBoundAuthSession(session, provider, options);
    await provider.closeSession(session);
    this.sessions.delete(id);
  }

  async closeAllSessions(options: CloseSessionOptions = {}): Promise<number> {
    const ids = [...this.sessions.keys()];

    await Promise.all(ids.map(async (id) => this.closeSession(id, options)));

    return ids.length;
  }

  async saveAuthSession(id: number, authSessionName: string): Promise<AuthSessionSummary> {
    const session = this.getSessionOrThrow(id);
    const provider = this.providers.get(session.provider);

    if (provider?.saveAuthSession === undefined) {
      throw new SessionRegistryError(
        `Provider "${session.provider}" does not support saved auth sessions.`,
      );
    }

    session.authSessionName = authSessionName;

    return provider.saveAuthSession(session, authSessionName);
  }

  async listAuthSessions(): Promise<AuthSessionSummary[]> {
    const summaries = await Promise.all(
      [...this.providers.values()].map(async (provider) => {
        if (provider.listAuthSessions === undefined) {
          return [];
        }

        return provider.listAuthSessions();
      }),
    );

    return summaries.flat();
  }

  private async saveBoundAuthSession(
    session: SessionRecord,
    provider: BrowserProvider,
    options: CloseSessionOptions,
  ): Promise<void> {
    if (session.authSessionName === null || provider.saveAuthSession === undefined) {
      return;
    }

    const saveConfig =
      'authSessionPersistence' in session.resolvedProviderConfig
        ? session.resolvedProviderConfig.authSessionPersistence
        : null;
    const shouldSave =
      options.reason === 'shutdown'
        ? saveConfig?.saveOnShutdown === true
        : saveConfig?.saveOnClose === true;

    if (!shouldSave) {
      return;
    }

    await provider.saveAuthSession(session, session.authSessionName);
  }

  private toSummary(session: SessionRecord): SessionSummary {
    return {
      id: session.id,
      provider: session.provider,
      providerSessionId: session.providerSessionId,
      sessionName: session.sessionName,
      authSessionName: session.authSessionName,
      createdAt: session.createdAt,
      lastUsedAt: session.lastUsedAt,
      metadata: session.metadata,
      resolvedProviderConfig: session.resolvedProviderConfig,
    };
  }
}
