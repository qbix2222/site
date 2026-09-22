import { nanoid } from 'nanoid';
import type { UIMessage } from 'ai';
import type {
  ChatSession,
  ModelRecord,
  OutboxEntry,
  ProviderAccount,
  SettingsState,
  SpendEntry,
  StoredMessageMeta,
  TurnSettings,
  WorkspaceNode,
} from '../core/types';
import type { RawCatalog } from '../catalog/models-dev';
import {
  CATALOG_CACHE_ID,
  MAX_FILE_VERSIONS,
  SETTINGS_KEY,
  database,
  type ChatSnapshot,
  type FileVersion,
  type StoredMessage,
  type StoredModelRecord,
  type StoredTerminalLine,
  type StoredWorkspaceNode,
} from './db';
import { isTextual, mediaTypeOf, normalizePath } from '../workspace/paths';

const compositeRange = (chatId: string): IDBKeyRange =>
  IDBKeyRange.bound([chatId, 0], [chatId, Number.MAX_SAFE_INTEGER]);

export const DEFAULT_TURN_SETTINGS: TurnSettings = {
  temperature: null,
  topP: null,
  maxOutputTokens: null,
  reasoningEffort: 'medium',
  thinkingBudget: null,
  verbosity: 'medium',
  maxToolRounds: 8,
  toolsEnabled: true,
  workspaceEnabled: true,
  executionEnabled: false,
  webEnabled: true,
  approvalRequired: true,
};

export const DEFAULT_SETTINGS: SettingsState = {
  theme: 'light',
  density: 'cozy',
  reduceMotion: false,
  sendOnEnter: true,
  language: 'ru',
  catalogTtlHours: 6,
  maxRetries: 3,
  retryBaseMs: 600,
  autoRouteByCapability: true,
  fallbackModelKey: null,
  keepAlivePingMs: 25000,
  persistRawResponses: false,
  haptics: true,
  backendUrl: '',
  providerRoute: 'auto',
  smallModelKey: null,
  webSearchEnabled: true,
  searchProvider: 'auto',
  braveApiKey: '',
  tavilyApiKey: '',
  serperApiKey: '',
  searxngUrl: '',
  autoCompactRatio: 0.85,
  economyMode: 'balanced',
  autoTitle: true,
};

export function createChat(partial?: Partial<ChatSession>): ChatSession {
  const now = Date.now();
  return {
    id: nanoid(12),
    title: 'Новый разговор',
    createdAt: now,
    updatedAt: now,
    pinned: false,
    archived: false,
    modelKey: null,
    persona: 'default',
    instructions: '',
    settings: { ...DEFAULT_TURN_SETTINGS },
    workspaceRoot: 'workspace',
    tokenBudgetRatio: 0.9,
    spendCapUsd: null,
    compactedBefore: 0,
    titleSource: 'auto',
    tags: [],
    ...partial,
  };
}

const normalizeChat = (chat: ChatSession): ChatSession => ({
  ...chat,
  compactedBefore: chat.compactedBefore ?? 0,
  titleSource: chat.titleSource ?? 'auto',
  tags: chat.tags ?? [],
});

export const emptyMessageMeta = (): StoredMessageMeta => ({
  turn: {
    status: 'settled',
    attempts: [],
    route: null,
    usage: null,
    trimmedMessages: 0,
    estimatedTokens: 0,
    contextWindow: 0,
    errorText: null,
    errorCode: null,
    createdAt: Date.now(),
    settledAt: null,
  },
  attachments: [],
  workspaceSnapshot: [],
});

export async function listChats(): Promise<ChatSession[]> {
  const db = await database();
  const chats = (await db.getAll('chats')).map(normalizeChat);
  return chats.sort(
    (left, right) =>
      Number(right.pinned) - Number(left.pinned) || right.updatedAt - left.updatedAt,
  );
}

export async function getChat(id: string): Promise<ChatSession | undefined> {
  const db = await database();
  const chat = await db.get('chats', id);
  return chat ? normalizeChat(chat) : undefined;
}

export async function putChat(chat: ChatSession): Promise<ChatSession> {
  const db = await database();
  const next: ChatSession = { ...chat, updatedAt: Date.now() };
  await db.put('chats', next);
  return next;
}

export async function deleteChat(id: string): Promise<void> {
  const db = await database();

  const [messageKeys, fileKeys, versionKeys, terminalKeys, outboxKeys, spendKeys] =
    await Promise.all([
      db.getAllKeysFromIndex('messages', 'by-chat', compositeRange(id)),
      db.getAllKeysFromIndex('workspace', 'by-chat', id),
      db.getAllKeysFromIndex('file-versions', 'by-chat', id),
      db.getAllKeysFromIndex('terminal', 'by-chat', compositeRange(id)),
      db.getAllKeysFromIndex('outbox', 'by-chat', id),
      db.getAllKeysFromIndex('spend', 'by-chat', id),
    ]);

  const transaction = db.transaction(
    ['chats', 'messages', 'workspace', 'file-versions', 'terminal', 'outbox', 'spend'],
    'readwrite',
  );

  transaction.objectStore('chats').delete(id);
  for (const [store, keys] of [
    ['messages', messageKeys],
    ['workspace', fileKeys],
    ['file-versions', versionKeys],
    ['terminal', terminalKeys],
    ['outbox', outboxKeys],
    ['spend', spendKeys],
  ] as const) {
    for (const key of keys) {
      transaction.objectStore(store).delete(key);
    }
  }

  await transaction.done;
}

export async function listMessages(chatId: string): Promise<StoredMessage[]> {
  const db = await database();
  return db.getAllFromIndex('messages', 'by-chat', compositeRange(chatId));
}

export async function putMessages(messages: StoredMessage[]): Promise<void> {
  if (!messages.length) return;
  const db = await database();
  const transaction = db.transaction('messages', 'readwrite');
  await Promise.all([
    ...messages.map((message) => transaction.store.put(message)),
    transaction.done,
  ]);
}

export async function nextSequence(chatId: string): Promise<number> {
  const db = await database();
  const rows = await db.getAllFromIndex(
    'messages',
    'by-chat',
    compositeRange(chatId),
  );
  return rows.length ? rows[rows.length - 1].seq + 1 : 0;
}

export async function deleteMessage(id: string): Promise<void> {
  const db = await database();
  await db.delete('messages', id);
}

export function toUIMessages(rows: StoredMessage[]): UIMessage[] {
  return rows.map((row) => ({
    id: row.id,
    role: row.role,
    parts: row.parts,
    metadata: row.meta,
  }));
}

export async function listFiles(chatId: string): Promise<StoredWorkspaceNode[]> {
  const db = await database();
  const rows = await db.getAllFromIndex('workspace', 'by-chat', chatId);
  return rows.sort((left, right) => left.path.localeCompare(right.path, 'ru'));
}

export async function getFile(chatId: string, path: string): Promise<StoredWorkspaceNode | undefined> {
  const db = await database();
  return db.getFromIndex('workspace', 'by-chat-path', [chatId, normalizePath(path)]);
}

export async function getFileById(id: string): Promise<StoredWorkspaceNode | undefined> {
  const db = await database();
  return db.get('workspace', id);
}

export async function putFile(
  chatId: string,
  path: string,
  content: { text?: string | null; dataUrl?: string | null },
  origin: WorkspaceNode['origin'],
): Promise<StoredWorkspaceNode> {
  const db = await database();
  const cleanPath = normalizePath(path);
  const existing = await db.getFromIndex('workspace', 'by-chat-path', [chatId, cleanPath]);
  const now = Date.now();

  const text = content.text ?? null;
  const size = text !== null ? new Blob([text]).size : content.dataUrl?.length ?? 0;

  const node: StoredWorkspaceNode = {
    id: existing?.id ?? nanoid(12),
    chatId,
    path: cleanPath,
    name: cleanPath.split('/').pop() ?? cleanPath,
    kind: 'file',
    size,
    mediaType: mediaTypeOf(cleanPath),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    origin,
    text: isTextual(cleanPath) ? text : null,
    dataUrl: text === null ? (content.dataUrl ?? existing?.dataUrl ?? null) : null,
  };

  if (existing && existing.text !== null && existing.text !== text) {
    await db.put('file-versions', {
      id: nanoid(12),
      chatId,
      fileId: existing.id,
      path: cleanPath,
      text: existing.text,
      size: existing.size,
      origin: existing.origin,
      savedAt: existing.updatedAt,
    } satisfies FileVersion);
    await pruneVersions(existing.id);
  }

  await db.put('workspace', node);
  return node;
}

const versionRange = (fileId: string): IDBKeyRange =>
  IDBKeyRange.bound([fileId, 0], [fileId, Number.MAX_SAFE_INTEGER]);

async function pruneVersions(fileId: string): Promise<void> {
  const db = await database();
  const rows = await db.getAllFromIndex('file-versions', 'by-file', versionRange(fileId));
  if (rows.length <= MAX_FILE_VERSIONS) return;

  const stale = rows
    .sort((left, right) => left.savedAt - right.savedAt)
    .slice(0, rows.length - MAX_FILE_VERSIONS);

  const transaction = db.transaction('file-versions', 'readwrite');
  for (const version of stale) {
    transaction.store.delete(version.id);
  }
  await transaction.done;
}

export async function listVersions(fileId: string): Promise<FileVersion[]> {
  const db = await database();
  const rows = await db.getAllFromIndex('file-versions', 'by-file', versionRange(fileId));
  return rows.sort((left, right) => right.savedAt - left.savedAt);
}

export async function deleteFile(chatId: string, path: string): Promise<void> {
  const db = await database();
  const existing = await db.getFromIndex('workspace', 'by-chat-path', [chatId, normalizePath(path)]);
  if (!existing) return;
  await db.delete('workspace', existing.id);
}

export async function renameFile(chatId: string, from: string, to: string): Promise<StoredWorkspaceNode> {
  const db = await database();
  const existing = await db.getFromIndex('workspace', 'by-chat-path', [chatId, normalizePath(from)]);
  if (!existing) throw new Error(`Файл «${from}» не найден`);

  const cleanTarget = normalizePath(to);
  const moved: StoredWorkspaceNode = {
    ...existing,
    path: cleanTarget,
    name: cleanTarget.split('/').pop() ?? cleanTarget,
    mediaType: mediaTypeOf(cleanTarget),
    updatedAt: Date.now(),
  };

  const transaction = db.transaction('workspace', 'readwrite');
  transaction.store.delete(existing.id);
  transaction.store.put(moved);
  await transaction.done;

  return moved;
}

export async function appendTerminal(
  chatId: string,
  lines: Array<{ stream: StoredTerminalLine['stream']; text: string }>,
): Promise<StoredTerminalLine[]> {
  if (!lines.length) return [];
  const db = await database();
  const existing = await db.getAllFromIndex(
    'terminal',
    'by-chat',
    compositeRange(chatId),
  );
  let seq = existing.length ? existing[existing.length - 1].seq + 1 : 0;

  const rows: StoredTerminalLine[] = lines.map((line) => ({
    id: nanoid(12),
    chatId,
    seq: seq++,
    at: Date.now(),
    stream: line.stream,
    text: line.text,
  }));

  const transaction = db.transaction('terminal', 'readwrite');
  await Promise.all([...rows.map((row) => transaction.store.put(row)), transaction.done]);
  return rows;
}

export async function listTerminal(chatId: string, limit = 500): Promise<StoredTerminalLine[]> {
  const db = await database();
  const rows = await db.getAllFromIndex(
    'terminal',
    'by-chat',
    compositeRange(chatId),
  );
  return rows.slice(-limit);
}

export async function clearTerminal(chatId: string): Promise<void> {
  const db = await database();
  const keys = await db.getAllKeysFromIndex('terminal', 'by-chat', compositeRange(chatId));
  if (!keys.length) return;

  const transaction = db.transaction('terminal', 'readwrite');
  await Promise.all([...keys.map((key) => transaction.store.delete(key)), transaction.done]);
}

export async function listAccounts(): Promise<ProviderAccount[]> {
  const db = await database();
  const rows = await db.getAllFromIndex('accounts', 'by-added');
  return rows.map((row) => ({
    ...row,
    headers: row.headers ?? {},
    opencode: row.opencode ?? false,
  }));
}

export async function putAccount(account: ProviderAccount): Promise<void> {
  const db = await database();
  await db.put('accounts', account);
}

export async function deleteAccount(id: string): Promise<void> {
  const db = await database();
  const transaction = db.transaction(['accounts', 'models'], 'readwrite');
  const models = await transaction.objectStore('models').index('by-account').getAllKeys(id);
  await Promise.all([
    transaction.objectStore('accounts').delete(id),
    ...models.map((key) => transaction.objectStore('models').delete(key)),
    transaction.done,
  ]);
}

export async function saveModels(accountId: string, records: ModelRecord[]): Promise<void> {
  const db = await database();
  const transaction = db.transaction('models', 'readwrite');
  const stale = await transaction.store.index('by-account').getAllKeys(accountId);
  const fresh = new Set(records.map((record) => record.key));

  await Promise.all([
    ...stale.filter((key) => !fresh.has(String(key))).map((key) => transaction.store.delete(key)),
    ...records.map((record) =>
      transaction.store.put({ ...record, accountId, savedAt: Date.now() } satisfies StoredModelRecord),
    ),
    transaction.done,
  ]);
}

export async function listModels(): Promise<StoredModelRecord[]> {
  const db = await database();
  return db.getAll('models');
}

export async function readCatalogCache(
  ttlMs: number,
): Promise<{ payload: RawCatalog; fetchedAt: number } | null> {
  const db = await database();
  const cached = await db.get('catalog', CATALOG_CACHE_ID);
  if (!cached) return null;
  if (Date.now() - cached.fetchedAt > ttlMs) return null;
  return { payload: cached.payload, fetchedAt: cached.fetchedAt };
}

export async function writeCatalogCache(payload: RawCatalog): Promise<void> {
  const db = await database();
  await db.put('catalog', { id: CATALOG_CACHE_ID, payload, fetchedAt: Date.now() });
}

export async function readSettings(): Promise<SettingsState> {
  const db = await database();
  const stored = await db.get('settings', SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(stored ?? {}) };
}

export async function writeSettings(settings: SettingsState): Promise<void> {
  const db = await database();
  await db.put('settings', { ...settings, id: SETTINGS_KEY });
}

export async function putOutbox(entry: OutboxEntry): Promise<void> {
  const db = await database();
  await db.put('outbox', entry);
}

export async function listOutbox(): Promise<OutboxEntry[]> {
  const db = await database();
  const rows = await db.getAll('outbox');
  return rows.sort((left, right) => left.createdAt - right.createdAt);
}

export async function deleteOutbox(id: string): Promise<void> {
  const db = await database();
  await db.delete('outbox', id);
}

export async function recordSpend(entry: Omit<SpendEntry, 'id'>): Promise<void> {
  const db = await database();
  await db.put('spend', { ...entry, id: nanoid(12) });
}

export async function listSpend(): Promise<SpendEntry[]> {
  const db = await database();
  return db.getAllFromIndex('spend', 'by-at');
}

export async function spendOfChat(chatId: string): Promise<number> {
  const rows = await listSpend();
  return rows
    .filter((row) => row.chatId === chatId)
    .reduce((sum, row) => sum + row.usage.costUsd, 0);
}

export async function exportChatSnapshot(chatId: string): Promise<ChatSnapshot | null> {
  const db = await database();
  const chat = await db.get('chats', chatId);
  if (!chat) return null;

  const [messages, files, terminal] = await Promise.all([
    listMessages(chatId),
    listFiles(chatId),
    listTerminal(chatId, 5000),
  ]);

  const fileIds = new Set(files.map((file) => file.id));
  const allVersions = await db.getAllFromIndex('file-versions', 'by-chat', chatId);

  return {
    chatId,
    chat,
    messages,
    files,
    versions: allVersions.filter((version) => fileIds.has(version.fileId)),
    terminal,
    savedAt: Date.now(),
  };
}

export async function clearEverything(): Promise<void> {
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
  await Promise.all([
    ...stores.map((store) => transaction.objectStore(store).clear()),
    transaction.done,
  ]);
}
