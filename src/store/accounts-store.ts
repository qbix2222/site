import { create } from 'zustand';
import {
  buildAccountModels,
  compareModels,
  mergeModelRecords,
  probeAccount,
  type DiscoveredModel,
  type ProbeResult,
} from '../catalog/discovery';
import { fetchCatalog, providerScope, splitModelKey, type RawCatalog } from '../catalog/models-dev';
import {
  opencodeConfigOf,
  parseOpencodeConfig,
  type OpencodeExportOptions,
  type OpencodeImport,
} from '../catalog/opencode';
import { createAccount, presetById, type AccountDraft } from '../core/providers';
import type { ModelRecord, ProviderAccount } from '../core/types';
import { useBackend } from './backend-store';
import {
  deleteAccount,
  listAccounts,
  listModels,
  putAccount,
  readCatalogCache,
  saveModels,
  writeCatalogCache,
} from './repository';

export interface CatalogState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  fetchedAt: number | null;
  error: string | null;
}

export interface ImportReport {
  added: string[];
  models: number;
  notices: string[];
}

export interface AccountState {
  accounts: ProviderAccount[];
  models: ModelRecord[];
  owners: Record<string, string>;
  catalog: CatalogState;
  raw: RawCatalog | null;
  probes: Record<string, ProbeResult>;
  discovering: Record<string, boolean>;
  booted: boolean;
  boot(ttlHours: number): Promise<void>;
  refreshCatalog(ttlHours: number, force?: boolean): Promise<void>;
  addAccount(draft: AccountDraft, extraModels?: DiscoveredModel[]): Promise<ProviderAccount>;
  updateAccount(account: ProviderAccount): Promise<void>;
  removeAccount(id: string): Promise<void>;
  discover(id: string, extraModels?: DiscoveredModel[]): Promise<ProbeResult>;
  importOpencode(text: string): Promise<ImportReport>;
  exportOpencode(options?: OpencodeExportOptions): string;
  check(id: string): Promise<ProbeResult>;
  accountFor(modelKey: string): ProviderAccount | undefined;
  modelsOf(accountId: string): ModelRecord[];
}

const scopeOf = (account: ProviderAccount): string => {
  try {
    return providerScope(account);
  } catch {
    return account.presetId;
  }
};

export const useAccounts = create<AccountState>((set, get) => ({
  accounts: [],
  models: [],
  owners: {},
  catalog: { status: 'idle', fetchedAt: null, error: null },
  raw: null,
  probes: {},
  discovering: {},
  booted: false,

  async boot(ttlHours) {
    const [accounts, stored] = await Promise.all([listAccounts(), listModels()]);
    const owners: Record<string, string> = {};
    const models = stored
      .map((row) => {
        owners[row.key] = row.accountId;
        const { accountId: _accountId, savedAt: _savedAt, ...record } = row;
        return record as ModelRecord;
      })
      .sort(compareModels);

    set({ accounts, models, owners, booted: true });
    await get().refreshCatalog(ttlHours);
  },

  async refreshCatalog(ttlHours, force = false) {
    const state = get();
    if (state.catalog.status === 'loading') return;

    const ttlMs = ttlHours * 60 * 60 * 1000;

    if (!force) {
      const cached = await readCatalogCache(ttlMs);
      if (cached) {
        set({
          raw: cached.payload,
          catalog: { status: 'ready', fetchedAt: cached.fetchedAt, error: null },
        });
        return;
      }
    }

    set({ catalog: { status: 'loading', fetchedAt: state.catalog.fetchedAt, error: null } });

    try {
      const payload = await fetchCatalog();
      await writeCatalogCache(payload);
      set({ raw: payload, catalog: { status: 'ready', fetchedAt: Date.now(), error: null } });
    } catch (error) {
      const stale = await readCatalogCache(Number.POSITIVE_INFINITY);
      const message = error instanceof Error ? error.message : 'Каталог моделей недоступен';

      set({
        raw: stale?.payload ?? state.raw,
        catalog: {
          status: stale ? 'ready' : 'error',
          fetchedAt: stale?.fetchedAt ?? null,
          error: stale ? null : message,
        },
      });
    }
  },

  async addAccount(draft, extraModels = []) {
    const account = createAccount(draft);
    await putAccount(account);
    set({ accounts: [...get().accounts, account] });

    await get().discover(account.id, extraModels).catch(() => undefined);

    return account;
  },

  async updateAccount(account) {
    await putAccount(account);
    set({ accounts: get().accounts.map((item) => (item.id === account.id ? account : item)) });
  },

  async removeAccount(id) {
    await deleteAccount(id);
    const kept = Object.fromEntries(
      Object.entries(get().owners).filter(([, accountId]) => accountId !== id),
    );

    set({
      accounts: get().accounts.filter((account) => account.id !== id),
      models: get().models.filter((model) => kept[model.key] !== undefined),
      owners: kept,
    });
  },

  async discover(id, extraModels = []) {
    const account = get().accounts.find((item) => item.id === id);
    if (!account) throw new Error('Подключение не найдено');

    set({ discovering: { ...get().discovering, [id]: true } });

    try {
      const policy = useBackend.getState().policy();
      const probe = await probeAccount(account, fetch, 12000, policy);
      const fromProvider = await buildAccountModels(account, get().raw, fetch, policy);
      const discovered = extraModels.length
        ? mergeModelRecords(account, fromProvider, extraModels)
        : fromProvider;
      await saveModels(account.id, discovered);

      const owners = { ...get().owners };
      for (const record of discovered) owners[record.key] = id;

      const others = get().models.filter((model) => owners[model.key] !== id);

      set({
        models: [...others, ...discovered].sort(compareModels),
        owners,
        probes: { ...get().probes, [id]: probe },
      });

      return probe;
    } finally {
      set({ discovering: { ...get().discovering, [id]: false } });
    }
  },

  async check(id) {
    const account = get().accounts.find((item) => item.id === id);
    if (!account) throw new Error('Подключение не найдено');

    const probe = await probeAccount(account, fetch, 12000, useBackend.getState().policy());
    const updated: ProviderAccount = {
      ...account,
      lastCheckedAt: Date.now(),
      lastStatus:
        probe.outcome === 'ok'
          ? 'ok'
          : probe.outcome === 'denied'
            ? 'denied'
            : 'unreachable',
      lastError: probe.message,
    };

    await putAccount(updated);
    set({
      accounts: get().accounts.map((item) => (item.id === id ? updated : item)),
      probes: { ...get().probes, [id]: probe },
    });

    return probe;
  },

  async importOpencode(text) {
    const parsed: OpencodeImport = parseOpencodeConfig(text);
    const added: string[] = [];
    const notices = [...parsed.notices];
    let models = 0;

    for (const profile of parsed.profiles) {
      const label = profile.draft.label;

      for (const notice of profile.notices) notices.push(`${label}: ${notice}`);

      if (!profile.draft.baseUrl) {
        notices.push(`${label}: пропущен, нет адреса сервера`);
        continue;
      }

      const account = await get().addAccount(profile.draft, profile.models);
      const owned = get().modelsOf(account.id);

      models += owned.length;
      added.push(label);
    }

    return { added, models, notices };
  },

  exportOpencode(options = {}) {
    const { accounts, models } = get();

    return opencodeConfigOf(accounts, models, options);
  },

  accountFor(modelKey) {
    const scope = splitModelKey(modelKey).scope;
    return get().accounts.find((account) => scopeOf(account) === scope);
  },

  modelsOf(accountId) {
    const { owners, models } = get();
    return models.filter((model) => owners[model.key] === accountId);
  },
}));

export const presetName = (presetId: string): string => presetById(presetId)?.name ?? presetId;
