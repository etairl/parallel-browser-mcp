import type { AuthSessionSummary, StartedBrowserSession } from '../types/session.js';
import type { ProviderName, SessionProxyConfig } from '../types/providerConfig.js';

export interface ProviderStartSessionParams {
  sessionName: string | null;
  authSessionName?: string | null;
  resume?: boolean;
  proxy?: SessionProxyConfig | null;
}

export abstract class BrowserProvider {
  readonly name: ProviderName;

  protected constructor(name: ProviderName) {
    this.name = name;
  }

  abstract startSession(params: ProviderStartSessionParams): Promise<StartedBrowserSession>;

  abstract closeSession(session: StartedBrowserSession): Promise<void>;

  saveAuthSession?(
    session: StartedBrowserSession,
    authSessionName: string,
  ): Promise<AuthSessionSummary>;

  listAuthSessions?(): Promise<AuthSessionSummary[]>;
}
