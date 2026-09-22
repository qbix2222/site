import { create } from 'zustand';
import type { UIMessage } from '@ai-sdk/react';
import type { LanguageModel } from 'ai';
import type { PendingApproval } from '../agent/approval';
import { buildInstructions, runtimeHints } from '../agent/instructions';
import type { AgentToolContext, WorkspaceFileView } from '../agent/tools';
import { describeUnsupported, findUnsupported, hasBlocker } from '../core/capabilities';
import { pickSmallModel } from '../core/economy';
import { createLanguageModel } from '../core/providers';
import { splitModelKey } from '../catalog/models-dev';
import type {
  Attachment,
  AttachmentKind,
  ChatSession,
  ModelRecord,
  RuntimeKind,
  SettingsState,
} from '../core/types';
import { SessionEngine, idleStatus, type SessionStatus, type TurnUsage } from '../engine/session';
import { saveText } from '../workspace/download';
import { mediaTypeOf, normalizePath } from '../workspace/paths';
import { summarizeWorkspace } from '../workspace/summary';
import { readPage, webSearch } from '../net/backend';
import { useAccounts } from './accounts-store';
import { useBackend } from './backend-store';
import { useSettings } from './settings-store';
import {
  backupSummary,
  exportEverything,
  isFullBackup,
  restoreEverything,
} from './backup';
import {
  clearEverything,
  createChat,
  deleteChat,
  deleteOutbox,
  exportChatSnapshot,
  getChat,
  listChats,
  listOutbox,
  listSpend,
  putChat,
} from './repository';
import { useWorkspace, workspaceViews } from './workspace-store';

export interface Notice {
  id: string;
  text: string;
  tone: 'info' | 'warn' | 'danger';
  at: number;
}

export interface PendingOutbox {
  id: string;
  chatId: string;
  text: string;
  createdAt: number;
}

interface ChatStoreState {
  sessions: ChatSession[];
  activeId: string | null;
  messages: UIMessage[];
  status: SessionStatus;
  usage: TurnUsage | null;
  notices: Notice[];
  pending: PendingOutbox[];
  spendTotalUsd: number;
  booted: boolean;
  engine: SessionEngine | null;

  boot(): Promise<void>;
  create(partial?: Partial<ChatSession>): Promise<ChatSession>;
  open(id: string): Promise<void>;
  close(): Promise<void>;
  update(id: string, changes: Partial<ChatSession>): Promise<void>;
  remove(id: string): Promise<void>;
  send(text: string, attachments: Attachment[]): Promise<void>;
  regenerate(): Promise<void>;
  stop(): Promise<void>;
  approve(approvalId: string, approved: boolean, reason?: string): void;
  compact(): Promise<boolean>;
  dismiss(noticeId: string): void;
  retryPending(id: string): Promise<void>;
  dropPending(id: string): Promise<void>;
  exportChat(id: string): Promise<void>;
  exportAll(): Promise<void>;
  restoreAll(text: string): Promise<boolean>;
  wipe(): Promise<void>;
  refreshSpend(): Promise<void>;
}

const kindOf = (mediaType: string): AttachmentKind => {
  if (mediaType.startsWith('image/')) return 'image';
  if (mediaType.startsWith('audio/')) return 'audio';
  if (mediaType.startsWith('video/')) return 'video';
  if (mediaType === 'application/pdf' || mediaType.startsWith('text/')) return 'document';
  return 'other';
};

export async function toAttachment(file: File): Promise<Attachment> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(`Не удалось прочитать ${file.name}`));
    reader.readAsDataURL(file);
  });

  return {
    id: `${Date.now().toString(36)}-${file.size.toString(36)}-${file.name.length}`,
    kind: kindOf(file.type),
    name: file.name,
    mediaType: file.type || mediaTypeOf(file.name),
    size: file.size,
    dataUrl,
  };
}

const titleFrom = (text: string): string => {
  const clean = text.trim().replace(/\s+/g, ' ');
  if (!clean) return 'Новый разговор';
  return clean.length > 48 ? `${clean.slice(0, 48)}…` : clean;
};

const slugOf = (title: string): string =>
  title
    .replace(/[^\wа-яё]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'razgovor';

let noticeSeq = 0;

export function pushNotice(text: string, tone: Notice['tone']): void {
  noticeSeq += 1;
  const notice: Notice = { id: `n-${noticeSeq}`, text, tone, at: Date.now() };

  useChatStore.setState((state) => ({ notices: [...state.notices, notice].slice(-6) }));

  if (useSettings.getState().haptics && 'vibrate' in navigator) {
    navigator.vibrate(tone === 'danger' ? [18, 40, 18] : tone === 'warn' ? 14 : 8);
  }
}

function createToolContext(chatId: string): AgentToolContext {
  const workspace = () => useWorkspace.getState();

  return {
    chatId,
    runtimeKind: 'none',
    runtime: null,

    async listFiles(): Promise<WorkspaceFileView[]> {
      return workspaceViews(workspace().nodes);
    },

    async readFile(path: string): Promise<string> {
      const clean = normalizePath(path);
      const node = workspace().nodes.find((item) => item.path === clean);

      if (!node) throw new Error(`Файла ${clean} нет в рабочей папке`);
      if (node.text === null) throw new Error(`Файл ${clean} бинарный, текстом его не прочитать`);

      return node.text;
    },

    async writeFile(path: string, text: string) {
      return workspace().write(chatId, normalizePath(path), text, 'agent');
    },

    async deleteFile(path: string) {
      await workspace().remove(chatId, normalizePath(path));
    },

    async logTerminal(stream, text) {
      await workspace().log(chatId, stream, text);
    },

    notify(text, tone = 'info') {
      pushNotice(text, tone);
    },

    async webSearch(query, count) {
      const settings = useSettings.getState();
      const outcome = await webSearch(query, useBackend.getState().status, {
        count,
        provider: settings.searchProvider,
        secrets: {
          braveApiKey: settings.braveApiKey || undefined,
          tavilyApiKey: settings.tavilyApiKey || undefined,
          serperApiKey: settings.serperApiKey || undefined,
          searxngUrl: settings.searxngUrl || undefined,
        },
      });

      return {
        query: outcome.query,
        provider: outcome.provider,
        answer: outcome.answer,
        notice: outcome.notice,
        hits: outcome.hits.map((hit) => ({
          title: hit.title,
          url: hit.url,
          snippet: hit.snippet,
          published: hit.published ?? null,
          source: hit.source,
        })),
      };
    },

    async webRead(url, maxChars) {
      const page = await readPage(url, useBackend.getState().status, maxChars);

      return {
        url: page.url,
        title: page.title,
        text: page.text,
        truncated: page.truncated,
        notice: page.notice,
      };
    },
  };
}

function capabilityWarning(record: ModelRecord, session: ChatSession): string | null {
  const reasoning = session.settings.reasoningEffort !== null && session.settings.reasoningEffort !== 'off';

  const report = findUnsupported(record.capabilities, record.limits, {
    hasImages: false,
    hasDocuments: false,
    hasAudio: false,
    needsTools: session.settings.toolsEnabled,
    needsReasoning: reasoning,
    usesTemperature: session.settings.temperature !== null,
    estimatedTokens: 0,
  });

  if (!hasBlocker(report) && !report.reasoning && !report.temperature) return null;

  return `${record.name}: ${describeUnsupported(report).join('; ')}`;
}

async function auxiliaryModel(): Promise<LanguageModel | null> {
  const accounts = useAccounts.getState();
  const record = pickSmallModel(accounts.models, useSettings.getState().smallModelKey);
  if (!record) return null;

  const account = accounts.accountFor(record.key);
  if (!account) return null;

  try {
    return await createLanguageModel(
      account,
      splitModelKey(record.key).id,
      useBackend.getState().policy(),
    );
  } catch {
    return null;
  }
}

function buildEngine(session: ChatSession): SessionEngine {
  const accounts = () => useAccounts.getState();

  const engine: SessionEngine = new SessionEngine({
    session,
    account: () => accounts().accountFor(session.modelKey ?? '') ?? null,
    appSettings: (): SettingsState => useSettings.getState(),
    policy: () => useBackend.getState().policy(),
    runtimePreference: useSettings.getState().runtimePreference,
    toolContext: createToolContext(session.id),
    models: () => accounts().models,

    auxiliary: auxiliaryModel,

    onSession(next) {
      useChatStore.setState({
        sessions: useChatStore.getState().sessions.map((item) => (item.id === next.id ? next : item)),
      });
    },

    onTitle(title) {
      const active = useChatStore.getState().activeId;
      if (active === session.id) pushNotice(`Название разговора: ${title}`, 'info');
    },

    onMessages(messages) {
      useChatStore.setState({ messages });
    },

    onStatus(status) {
      useChatStore.setState({ status });
    },

    onNotify(text, tone = 'info') {
      pushNotice(text, tone);
    },

    onUsage(usage) {
      useChatStore.setState({ usage });
      void useChatStore.getState().refreshSpend();
    },

    async instructions() {
      const nodes = useWorkspace.getState().nodes;
      const kind: RuntimeKind = engine.runtimeInfo().kind;

      return buildInstructions({
        persona: session.persona,
        systemPrompt: session.instructions,
        settings: session.settings,
        workspaceSummary: summarizeWorkspace(nodes),
        runtimeHint: runtimeHints[kind],
        language: useSettings.getState().language,
      });
    },
  });

  return engine;
}

export const useChatStore = create<ChatStoreState>((set, get) => ({
  sessions: [],
  activeId: null,
  messages: [],
  status: idleStatus(),
  usage: null,
  notices: [],
  pending: [],
  spendTotalUsd: 0,
  booted: false,
  engine: null,

  async boot() {
    const [sessions, outbox] = await Promise.all([listChats(), listOutbox()]);

    set({
      sessions,
      pending: outbox.map((entry) => ({
        id: entry.id,
        chatId: entry.chatId,
        text: entry.text,
        createdAt: entry.createdAt,
      })),
      booted: true,
    });

    await get().refreshSpend();

    const latest = sessions.find((session) => !session.archived) ?? sessions[0];
    if (latest) await get().open(latest.id);
  },

  async create(partial) {
    const session = createChat(partial);
    await putChat(session);
    set({ sessions: [session, ...get().sessions] });
    await get().open(session.id);
    return session;
  },

  async open(id) {
    const state = get();
    if (state.activeId === id && state.engine) return;

    await state.engine?.dispose();

    const session = (await getChat(id)) ?? state.sessions.find((item) => item.id === id);
    if (!session) return;

    const accounts = useAccounts.getState();
    const settings = useSettings.getState();

    if (!session.modelKey) {
      const preferred = settings.fallbackModelKey
        ? accounts.models.find((model) => model.key === settings.fallbackModelKey)
        : accounts.models[0];
      session.modelKey = preferred?.key ?? null;
    }

    const record = session.modelKey
      ? accounts.models.find((model) => model.key === session.modelKey)
      : undefined;

    if (record) {
      const warning = capabilityWarning(record, session);
      if (warning) pushNotice(warning, 'warn');
    } else if (session.modelKey) {
      pushNotice('Выбранная модель недоступна — обновите список моделей провайдера', 'warn');
    }

    useWorkspace.setState({ selectedPath: null });
    await useWorkspace.getState().load(session.id);

    const engine = buildEngine(session);
    set({ engine, activeId: id, messages: [], status: idleStatus(), usage: null });

    await engine.open();
    set({ messages: engine.currentChat?.messages ?? [] });
  },

  async close() {
    await get().engine?.dispose();
    set({ engine: null, activeId: null, messages: [], status: idleStatus(), usage: null });
  },

  async update(id, changes) {
    const session = await getChat(id);
    if (!session) return;

    const renamed = changes.title !== undefined && changes.titleSource === undefined;
    const next: ChatSession = {
      ...session,
      ...changes,
      titleSource: renamed ? 'user' : (changes.titleSource ?? session.titleSource),
      updatedAt: Date.now(),
    };
    await putChat(next);

    set({ sessions: get().sessions.map((item) => (item.id === id ? next : item)) });

    if (id === get().activeId) {
      get().engine?.applySession(next);
    }
  },

  async remove(id) {
    await deleteChat(id);
    const sessions = get().sessions.filter((session) => session.id !== id);
    set({ sessions });

    if (get().activeId === id) {
      await get().engine?.dispose();
      set({ engine: null, activeId: null, messages: [], status: idleStatus(), usage: null });

      const next = sessions[0];
      if (next) await get().open(next.id);
    }
  },

  async send(text, attachments) {
    const state = get();
    const { engine } = state;
    const session = state.sessions.find((item) => item.id === state.activeId);

    if (!engine || !session) {
      pushNotice('Сначала создайте разговор и выберите модель', 'warn');
      return;
    }

    const trimmed = text.trim();
    if (!trimmed && !attachments.length) return;

    const accounts = useAccounts.getState();

    if (!session.modelKey || !accounts.models.some((model) => model.key === session.modelKey)) {
      pushNotice('Для этого разговора не выбрана рабочая модель', 'warn');
      return;
    }

    if (!accounts.accountFor(session.modelKey)) {
      pushNotice('Провайдер этой модели отключён', 'danger');
      return;
    }

    if (!navigator.onLine) {
      pushNotice('Нет соединения: сообщение поставлено в очередь и уйдёт само', 'warn');
      return;
    }

    if (!session.title || session.title === 'Новый разговор') {
      await get().update(session.id, { title: titleFrom(trimmed), titleSource: 'auto' });
    }

    await engine.send({ text: trimmed, attachments });
    await get().refreshSpend();
  },

  async compact() {
    const engine = get().engine;
    if (!engine) {
      pushNotice('Сначала откройте разговор', 'warn');
      return false;
    }

    const done = await engine.compact();
    if (!done) pushNotice('Сжимать пока нечего: история короткая', 'info');
    await get().refreshSpend();
    return done;
  },

  async regenerate() {
    await get().engine?.regenerate();
  },

  async stop() {
    await get().engine?.stop();
  },

  approve(approvalId, approved, reason) {
    get().engine?.approve(approvalId, approved, reason);
  },

  dismiss(noticeId) {
    set({ notices: get().notices.filter((notice) => notice.id !== noticeId) });
  },

  async retryPending(id) {
    const rows = await listOutbox();
    const row = rows.find((item) => item.id === id);
    if (!row) {
      set({ pending: get().pending.filter((item) => item.id !== id) });
      return;
    }

    if (row.chatId !== get().activeId) await get().open(row.chatId);

    await get().send(row.text, row.attachments);
    await deleteOutbox(id);
    set({ pending: get().pending.filter((item) => item.id !== id) });
  },

  async dropPending(id) {
    await deleteOutbox(id);
    set({ pending: get().pending.filter((item) => item.id !== id) });
  },

  async exportChat(id) {
    const snapshot = await exportChatSnapshot(id);

    if (!snapshot) {
      pushNotice('Нечего выгружать: разговор пуст', 'warn');
      return;
    }

    saveText(`pult-${slugOf(snapshot.chat.title)}.json`, JSON.stringify(snapshot, null, 2));
    pushNotice(`Разговор «${snapshot.chat.title}» выгружен`, 'info');
  },

  async exportAll() {
    const backup = await exportEverything();

    saveText(
      `pult-backup-${new Date(backup.savedAt).toISOString().slice(0, 10)}.json`,
      JSON.stringify(backup, null, 2),
    );

    pushNotice(`Резервная копия сохранена: ${backupSummary(backup)}`, 'info');
  },

  async restoreAll(text) {
    let parsed: unknown;

    try {
      parsed = JSON.parse(text);
    } catch {
      pushNotice('Файл не читается как JSON', 'danger');
      return false;
    }

    if (!isFullBackup(parsed)) {
      pushNotice('Это не резервная копия Пульта: не нашлось разделов chats и messages', 'danger');
      return false;
    }

    await get().engine?.dispose();
    await restoreEverything(parsed);

    set({
      engine: null,
      activeId: null,
      messages: [],
      status: idleStatus(),
      usage: null,
      pending: [],
    });

    await useSettings.getState().boot();
    await useAccounts.getState().boot(useSettings.getState().catalogTtlHours);
    await get().boot();

    pushNotice(`Восстановлено: ${backupSummary(parsed)}`, 'info');

    return true;
  },

  async wipe() {
    await get().engine?.dispose();
    await clearEverything();

    set({
      sessions: [],
      activeId: null,
      messages: [],
      status: idleStatus(),
      usage: null,
      pending: [],
      spendTotalUsd: 0,
      engine: null,
    });

    useWorkspace.setState({ nodes: [], terminal: [], chatId: null, selectedPath: null });
  },

  async refreshSpend() {
    const rows = await listSpend();
    const total = rows.reduce((sum, row) => sum + row.usage.costUsd, 0);
    set({ spendTotalUsd: Math.round(total * 1e6) / 1e6 });
  },
}));

export const activeSession = (state: ChatStoreState): ChatSession | null =>
  state.sessions.find((session) => session.id === state.activeId) ?? null;

export const pendingApprovalOf = (status: SessionStatus): PendingApproval | null => status.approval;

export const textOfMessage = (message: UIMessage): string =>
  message.parts
    .filter((part) => part.type === 'text')
    .map((part) => (part as { text: string }).text)
    .join('');
