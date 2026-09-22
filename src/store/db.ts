import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { UIMessage } from 'ai';
import type {
  ChatSession,
  ModelRecord,
  OutboxEntry,
  ProviderAccount,
  SettingsState,
  SpendEntry,
  StoredMessageMeta,
  TerminalLine,
  WorkspaceNode,
} from '../core/types';
import type { RawCatalog } from '../catalog/models-dev';

export interface StoredMessage {
  id: string;
  chatId: string;
  seq: number;
  role: UIMessage['role'];
  parts: UIMessage['parts'];
  meta: StoredMessageMeta;
  createdAt: number;
}

export type StoredWorkspaceNode = WorkspaceNode & { chatId: string };
export type StoredTerminalLine = TerminalLine & { chatId: string; seq: number };
export type StoredModelRecord = ModelRecord & { accountId: string; savedAt: number };

export interface FileVersion {
  id: string;
  chatId: string;
  fileId: string;
  path: string;
  text: string;
  size: number;
  origin: WorkspaceNode['origin'];
  savedAt: number;
}

export interface ChatSnapshot {
  chatId: string;
  chat: ChatSession;
  messages: StoredMessage[];
  files: StoredWorkspaceNode[];
  versions: FileVersion[];
  terminal: StoredTerminalLine[];
  savedAt: number;
}

interface CatalogCache {
  id: string;
  payload: RawCatalog;
  fetchedAt: number;
}

interface PultSchema extends DBSchema {
  chats: {
    key: string;
    value: ChatSession;
    indexes: { 'by-updated': number };
  };
  messages: {
    key: string;
    value: StoredMessage;
    indexes: { 'by-chat': [string, number] };
  };
  workspace: {
    key: string;
    value: StoredWorkspaceNode;
    indexes: { 'by-chat': string; 'by-chat-path': [string, string] };
  };
  'file-versions': {
    key: string;
    value: FileVersion;
    indexes: { 'by-chat': string; 'by-file': [string, number] };
  };
  terminal: {
    key: string;
    value: StoredTerminalLine;
    indexes: { 'by-chat': [string, number] };
  };
  outbox: {
    key: string;
    value: OutboxEntry;
    indexes: { 'by-state': string; 'by-chat': string };
  };
  accounts: {
    key: string;
    value: ProviderAccount;
    indexes: { 'by-added': number };
  };
  models: {
    key: string;
    value: StoredModelRecord;
    indexes: { 'by-account': string };
  };
  catalog: {
    key: string;
    value: CatalogCache;
  };
  spend: {
    key: string;
    value: SpendEntry;
    indexes: { 'by-at': number; 'by-chat': string };
  };
  settings: {
    key: string;
    value: SettingsState & { id: string };
  };
}

const DB_NAME = 'pult';
const DB_VERSION = 1;

let connection: Promise<IDBPDatabase<PultSchema>> | null = null;

export function database(): Promise<IDBPDatabase<PultSchema>> {
  if (!connection) {
    connection = openDB<PultSchema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('chats')) {
          const store = db.createObjectStore('chats', { keyPath: 'id' });
          store.createIndex('by-updated', 'updatedAt');
        }
        if (!db.objectStoreNames.contains('messages')) {
          const store = db.createObjectStore('messages', { keyPath: 'id' });
          store.createIndex('by-chat', ['chatId', 'seq']);
        }
        if (!db.objectStoreNames.contains('workspace')) {
          const store = db.createObjectStore('workspace', { keyPath: 'id' });
          store.createIndex('by-chat', 'chatId');
          store.createIndex('by-chat-path', ['chatId', 'path']);
        }
        if (!db.objectStoreNames.contains('file-versions')) {
          const store = db.createObjectStore('file-versions', { keyPath: 'id' });
          store.createIndex('by-chat', 'chatId');
          store.createIndex('by-file', ['fileId', 'savedAt']);
        }
        if (!db.objectStoreNames.contains('terminal')) {
          const store = db.createObjectStore('terminal', { keyPath: 'id' });
          store.createIndex('by-chat', ['chatId', 'seq']);
        }
        if (!db.objectStoreNames.contains('outbox')) {
          const store = db.createObjectStore('outbox', { keyPath: 'id' });
          store.createIndex('by-state', 'state');
          store.createIndex('by-chat', 'chatId');
        }
        if (!db.objectStoreNames.contains('accounts')) {
          const store = db.createObjectStore('accounts', { keyPath: 'id' });
          store.createIndex('by-added', 'addedAt');
        }
        if (!db.objectStoreNames.contains('models')) {
          const store = db.createObjectStore('models', { keyPath: 'key' });
          store.createIndex('by-account', 'accountId');
        }
        if (!db.objectStoreNames.contains('catalog')) {
          db.createObjectStore('catalog', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('spend')) {
          const store = db.createObjectStore('spend', { keyPath: 'id' });
          store.createIndex('by-at', 'at');
          store.createIndex('by-chat', 'chatId');
        }
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'id' });
        }
      },
    });
  }
  return connection;
}

export const CATALOG_CACHE_ID = 'models-dev';
export const SETTINGS_KEY = 'settings';
export const MAX_FILE_VERSIONS = 20;
