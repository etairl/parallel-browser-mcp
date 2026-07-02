import {
  chromium,
  type Browser,
  type BrowserContextOptions,
  type LaunchOptions,
} from 'playwright';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import type { ResolvedPlaywrightProviderConfig } from '../config/serverConfig.js';
import type { AuthSessionSummary, StartedBrowserSession } from '../types/session.js';
import { BrowserProvider, type ProviderStartSessionParams } from './BrowserProvider.js';

type CloakBrowserModule = {
  launch: (options?: LaunchOptions) => Promise<Browser>;
};

interface AuthSessionMetadata {
  name: string;
  key: string;
  provider: 'playwright';
  createdAt: string;
  updatedAt: string;
}

const loadCloakBrowser = async (): Promise<CloakBrowserModule> => {
  // Use an indirect specifier so TypeScript / bundlers don't require `cloakbrowser`
  // to be installed at build time. It's an optional peer the user installs only if
  // they opt into stealth mode.
  const moduleId = 'cloakbrowser';
  try {
    return (await import(/* @vite-ignore */ moduleId)) as CloakBrowserModule;
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(
      `Playwright provider has useCloakBrowser enabled but the 'cloakbrowser' package is not installed. ` +
        `Install it with 'npm install cloakbrowser' (https://cloakbrowser.dev/). Underlying error: ${reason}`,
    );
  }
};

export class PlaywrightProvider extends BrowserProvider {
  constructor(private readonly config: ResolvedPlaywrightProviderConfig) {
    super('playwright');
  }

  async startSession(params: ProviderStartSessionParams): Promise<StartedBrowserSession> {
    const launchOptions: LaunchOptions = {
      ...(this.config.launchOptions as LaunchOptions),
    };

    if (this.config.executablePath !== null) {
      launchOptions.executablePath = this.config.executablePath;
    }

    if (this.config.channel !== null) {
      launchOptions.channel = this.config.channel;
    }

    const browser = this.config.useCloakBrowser
      ? await (await loadCloakBrowser()).launch(launchOptions)
      : await chromium.launch(launchOptions);
    const contextOptions: BrowserContextOptions = {
      ...(this.config.contextOptions as BrowserContextOptions),
    };

    if (params.proxy !== undefined && params.proxy !== null) {
      contextOptions.proxy = params.proxy;
    }

    const authSessionName = params.authSessionName ?? null;
    const authSession =
      authSessionName !== null ? this.resolveAuthSession(authSessionName) : null;

    if (authSession !== null && !this.config.authSessionPersistence.enabled) {
      throw new Error('Playwright auth session persistence is disabled.');
    }

    if (
      authSession !== null &&
      (params.resume ?? true) &&
      existsSync(authSession.storageStatePath)
    ) {
      contextOptions.storageState = authSession.storageStatePath;
    } else if (this.config.storageStatePath !== null) {
      contextOptions.storageState = this.config.storageStatePath;
    }

    const context = await browser.newContext(contextOptions);
    const page = await context.newPage();

    return {
      browser,
      context,
      page,
      providerSessionId: null,
      metadata: {
        isLocal: true,
        stealth: this.config.useCloakBrowser,
        authSessionName,
        persistentAuth: authSession !== null,
      },
      resolvedProviderConfig: {
        ...this.config,
        contextOptions: contextOptions as Record<string, unknown>,
      },
    };
  }

  async closeSession(session: StartedBrowserSession): Promise<void> {
    await session.page.close().catch(() => undefined);
    await session.context.close().catch(() => undefined);
    await session.browser.close().catch(() => undefined);
  }

  async saveAuthSession(
    session: StartedBrowserSession,
    authSessionName: string,
  ): Promise<AuthSessionSummary> {
    if (!this.config.authSessionPersistence.enabled) {
      throw new Error('Playwright auth session persistence is disabled.');
    }

    const authSession = this.resolveAuthSession(authSessionName);
    await mkdir(authSession.dir, { recursive: true });
    await session.context.storageState({ path: authSession.storageStatePath });

    const existingMetadata = await this.readMetadata(authSession.metadataPath);
    const now = new Date().toISOString();
    const metadata: AuthSessionMetadata = {
      name: authSessionName,
      key: authSession.key,
      provider: 'playwright',
      createdAt: existingMetadata?.createdAt ?? now,
      updatedAt: now,
    };

    await writeFile(authSession.metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');

    return this.toSummary(metadata, true);
  }

  async listAuthSessions(): Promise<AuthSessionSummary[]> {
    if (!this.config.authSessionPersistence.enabled) {
      return [];
    }

    const rootDir = this.authSessionRootDir();
    if (!existsSync(rootDir)) {
      return [];
    }

    const entries = await readdir(rootDir, { withFileTypes: true });
    const summaries = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => {
          const authSession = this.resolveAuthSession(entry.name);
          const metadata = await this.readMetadata(authSession.metadataPath);

          return this.toSummary(
            metadata ?? {
              name: entry.name,
              key: entry.name,
              provider: 'playwright',
              createdAt: null,
              updatedAt: null,
            },
            existsSync(authSession.storageStatePath),
          );
        }),
    );

    return summaries.sort((left, right) => left.name.localeCompare(right.name));
  }

  private authSessionRootDir(): string {
    return resolve(process.cwd(), this.config.authSessionPersistence.rootDir);
  }

  private resolveAuthSession(authSessionName: string): {
    key: string;
    dir: string;
    metadataPath: string;
    storageStatePath: string;
  } {
    const key = this.toAuthSessionKey(authSessionName);
    const rootDir = this.authSessionRootDir();
    const dir = resolve(rootDir, key);

    if (dir !== rootDir && !dir.startsWith(`${rootDir}${sep}`)) {
      throw new Error(`Auth session path escaped the configured root: ${authSessionName}`);
    }

    return {
      key,
      dir,
      metadataPath: resolve(dir, 'metadata.json'),
      storageStatePath: resolve(dir, 'storage-state.json'),
    };
  }

  private toAuthSessionKey(authSessionName: string): string {
    const key = authSessionName
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80);

    if (key.length === 0) {
      throw new Error(`Invalid auth session name "${authSessionName}".`);
    }

    return key;
  }

  private async readMetadata(metadataPath: string): Promise<AuthSessionMetadata | null> {
    if (!existsSync(metadataPath)) {
      return null;
    }

    try {
      return JSON.parse(await readFile(metadataPath, 'utf8')) as AuthSessionMetadata;
    } catch {
      return null;
    }
  }

  private toSummary(
    metadata: AuthSessionMetadata | {
      name: string;
      key: string;
      provider: 'playwright';
      createdAt: string | null;
      updatedAt: string | null;
    },
    hasStorageState: boolean,
  ): AuthSessionSummary {
    return {
      name: metadata.name,
      key: metadata.key,
      provider: 'playwright',
      createdAt: metadata.createdAt,
      updatedAt: metadata.updatedAt,
      hasStorageState,
    };
  }
}
