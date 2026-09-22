import type { ChatSession, ProviderAccount, SettingsState, SpendEntry } from '../core/types';
import { DEFAULT_SETTINGS } from './repository';
import {
  SETTINGS_KEY,
  database,
  type FileVersion,
  type StoredMessage,
  type StoredModelRecord,
  type StoredTerminalLine,
  type StoredWorkspaceNode,
} from './db';

export interface FullBackup {
  app: 'pult';
  version: 1;
  savedAt: number;
  chats: ChatSession[];
  messages: StoredMessage[];
  files: StoredWorkspaceNode[];
  versions: FileVersion[];
  terminal: StoredTerminalLine[];
  accounts: ProviderAccount[];
  models: StoredModelRecord[];
  spend: SpendEntry[];
  settings: SettingsState;
}

const isArrayOf = (value: unknown): value is unknown[] => Array.isArray(value);

function stripId(row: (SettingsState & { id: string }) | undefined): SettingsState {
  if (!row) return { ...DEFAULT_SETTINGS };

  const { id: _id, ...settings } = row;

  return settings;
}

export function isFullBackup(value: unknown): value is FullBackup {
  if (!value || typeof value !== 'object') return false;

  const candidate = value as Partial<FullBackup>;

  return (
    candidate.app === 'pult' &&
    isArrayOf(candidate.chats) &&
    isArrayOf(candidate.messages) &&
    isArrayOf(candidate.files) &&
    isArrayOf(candidate.accounts) &&
    isArrayOf(candidate.models)
  );
}

export async function exportEverything(): Promise<FullBackup> {
  const db = await database();

  const [chats, messages, files, versions, terminal, accounts, models, spend, settings] =
    await Promise.all([
      db.getAll('chats'),
      db.getAll('messages'),
      db.getAll('workspace'),
      db.getAll('file-versions'),
      db.getAll('terminal'),
      db.getAllFromIndex('accounts', 'by-added'),
      db.getAll('models'),
      db.getAll('spend'),
      db.getAll('settings'),
    ]);

  return {
    app: 'pult',
    version: 1,
    savedAt: Date.now(),
    chats,
    messages,
    files,
    versions,
    terminal,
    accounts,
    models,
    spend,
    settings: stripId(settings[0]),
  };
}

export async function restoreEverything(backup: FullBackup): Promise<void> {
  const db = await database();

  const stores = [
    'chats',
    'messages',
    'workspace',
    'file-versions',
    'terminal',
    'outbox',
    'accounts',
    'models',
    'catalog',
    'spend',
    'settings',
  ] as const;

  const transaction = db.transaction([...stores], 'readwrite');

  await Promise.all(stores.map((store) => transaction.objectStore(store).clear()));

  const writes: Array<Promise<unknown>> = [
    ...backup.chats.map((row) => transaction.objectStore('chats').put(row)),
    ...backup.messages.map((row) => transaction.objectStore('messages').put(row)),
    ...backup.files.map((row) => transaction.objectStore('workspace').put(row)),
    ...backup.versions.map((row) => transaction.objectStore('file-versions').put(row)),
    ...backup.terminal.map((row) => transaction.objectStore('terminal').put(row)),
    ...backup.accounts.map((row) => transaction.objectStore('accounts').put(row)),
    ...backup.models.map((row) => transaction.objectStore('models').put(row)),
    ...backup.spend.map((row) => transaction.objectStore('spend').put(row)),
  ];

  if (backup.settings && Object.keys(backup.settings).length) {
    writes.push(transaction.objectStore('settings').put({ ...backup.settings, id: SETTINGS_KEY }));
  }

  await Promise.all(writes);
  await transaction.done;
}

export const backupSummary = (backup: FullBackup): string =>
  `${backup.chats.length} разговоров, ${backup.messages.length} сообщений, ${backup.files.length} файлов, ${backup.accounts.length} подключений, ${backup.models.length} моделей`;
