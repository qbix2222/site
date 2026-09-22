import {
  ToolLoopAgent,
  lastAssistantMessageIsCompleteWithApprovalResponses,
  stepCountIs,
} from 'ai';
import type { FileUIPart, LanguageModel, ToolApprovalConfiguration, ToolSet, UIMessage } from 'ai';
import { Chat } from '@ai-sdk/react';
import { findPendingApproval, type PendingApproval } from '../agent/approval';
import { AgentHolder } from '../agent/mutable';
import { LocalAgentTransport } from '../agent/transport';
import { buildAgentTools, type AgentToolContext } from '../agent/tools';
import { createLanguageModel, type EndpointPolicy } from '../core/providers';
import { splitModelKey } from '../catalog/models-dev';
import { resolveRoute, sameProviderPool, type RouteRequest } from '../core/router';
import {
  budgetFor,
  emptyUsage,
  estimateMessageTokens,
  estimateToolSchemaTokens,
  estimateUsageCost,
  fitContext,
  type FitBudget,
} from '../core/tokens';
import type {
  Attachment,
  ChatSession,
  ModelRecord,
  ProviderAccount,
  SettingsState,
  UsageRecord,
} from '../core/types';
import { chooseRuntime, syncWorkspace, type RuntimeChoice, type RuntimePreference } from '../runtime';
import type { RuntimeKind } from '../core/types';
import {
  deleteOutbox,
  emptyMessageMeta,
  listFiles,
  listMessages,
  nextSequence,
  putChat,
  putMessages,
  putOutbox,
  recordSpend,
  spendOfChat,
  toUIMessages,
} from '../store/repository';
import type { StoredMessage } from '../store/db';
import { checkBudget } from '../core/economy';
import { describeAttempt, planRecovery } from './recovery';
import { callSettingsFor } from './model-options';
import { digestMessage, isDigest, splitForCompaction, summarizeHistory } from './compact';
import { suggestTitle } from './title';
import { backoffDelay, delay, diagnose, type ErrorDiagnosis } from './retry';

export type SessionPhase =
  | 'idle'
  | 'preparing'
  | 'streaming'
  | 'awaiting-approval'
  | 'retrying'
  | 'failed';

export interface SessionStatus {
  phase: SessionPhase;
  note: string;
  attempt: number;
  approval: PendingApproval | null;
  failure: ErrorDiagnosis | null;
  elapsedMs: number;
}

export const idleStatus = (): SessionStatus => ({
  phase: 'idle',
  note: '',
  attempt: 0,
  approval: null,
  failure: null,
  elapsedMs: 0,
});

export interface TurnUsage extends UsageRecord {
  modelKey: string;
  timeToFirstChunkMs: number | null;
  attempts: number;
}

export interface SessionDeps {
  readonly session: ChatSession;
  account(): ProviderAccount | null;
  appSettings(): SettingsState;
  policy(): EndpointPolicy;
  readonly runtimePreference: RuntimePreference;
  readonly toolContext: AgentToolContext;
  models(): ModelRecord[];
  instructions(): Promise<string>;
  onMessages(messages: UIMessage[]): void;
  onStatus(status: SessionStatus): void;
  onNotify(text: string, tone?: 'info' | 'warn' | 'danger'): void;
  onUsage(usage: TurnUsage): void;
  onSession(session: ChatSession): void;
  onTitle(title: string): void;
  auxiliary(): Promise<LanguageModel | null>;
}

const COMPACT_KEEP_TAIL = 6;
const COMPACT_MIN_HEAD = 4;

function contextView(rows: StoredMessage[], compactedBefore: number): UIMessage[] {
  const messages = toUIMessages(rows);

  if (!compactedBefore) return messages;

  const digest = messages.filter(isDigest).at(-1);
  const tail = messages.filter((message, index) => rows[index].seq >= compactedBefore && !isDigest(message));

  return digest ? [digest, ...tail] : tail;
}

export interface SendRequest {
  text: string;
  attachments: Attachment[];
}

const GATED_TOOLS = new Set(['run_command', 'run_javascript', 'delete_file', 'patch_file', 'write_file']);
const OUTPUT_RESERVE_TOKENS = 4_096;

interface TurnState {
  model: ModelRecord;
  outboxId: string;
  startedAt: number;
  attempts: number;
  trimmed: number;
  estimatedTokens: number;
  instructionsTokens: number;
  toolsTokens: number;
  firstProgressAt: number | null;
  lastProgressAt: number;
  settled: boolean;
  outcome: TurnOutcome | null;
  settle: (outcome: TurnOutcome) => void;
}

type TurnOutcome =
  | { kind: 'finished'; messages: UIMessage[]; aborted: boolean }
  | { kind: 'approval'; messages: UIMessage[]; pending: PendingApproval }
  | { kind: 'error'; error: Error };

export class SessionEngine {
  private readonly deps: SessionDeps;
  private readonly holder = new AgentHolder();
  private chat: Chat<UIMessage> | null = null;
  private runtime: RuntimeChoice | null = null;
  private tools: ToolSet = {};
  private instructions = '';
  private turn: TurnState | null = null;
  private watcher: ReturnType<typeof setInterval> | null = null;
  private lastSignature = '';

  constructor(deps: SessionDeps) {
    this.deps = deps;
  }

  get currentChat(): Chat<UIMessage> | null {
    return this.chat;
  }

  runtimeInfo(): { kind: RuntimeKind; fallbackReason: string | null } {
    return {
      kind: this.runtime?.kind ?? 'none',
      fallbackReason: this.runtime?.fallbackReason ?? null,
    };
  }

  async open(): Promise<Chat<UIMessage>> {
    this.runtime = chooseRuntime(this.deps.runtimePreference);

    if (this.runtime.fallbackReason) {
      this.deps.onNotify(this.runtime.fallbackReason, 'warn');
    }

    const rows = await listMessages(this.deps.session.id);
    this.chat = this.createChat(contextView(rows, this.deps.session.compactedBefore));

    return this.chat;
  }

  private createChat(messages: UIMessage[]): Chat<UIMessage> {
    const chat = new Chat<UIMessage>({
      id: this.deps.session.id,
      messages,
      transport: new LocalAgentTransport(this.holder),
      sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
      onFinish: (event) => {
        this.complete(event.messages, event.isAbort);
      },
      onError: (error) => {
        this.complete(null, false, error instanceof Error ? error : new Error(String(error)));
      },
    });

    this.deps.onMessages(chat.messages);

    return chat;
  }

  async send(request: SendRequest): Promise<void> {
    const chat = this.chat ?? (await this.open());
    const settings = this.deps.session.settings;

    if (this.turn) {
      this.deps.onNotify('Предыдущий ход ещё не завершён', 'warn');
      return;
    }

    this.status({ phase: 'preparing', note: 'собираем ход' });

    if (!(await this.allowBySpendCap())) return;

    const nodes = await listFiles(this.deps.session.id);
    this.instructions = await this.deps.instructions();
    const runtime = this.runtime;
    this.tools = settings.toolsEnabled
      ? buildAgentTools(
          {
            ...this.deps.toolContext,
            runtime: runtime?.runtime ?? null,
            runtimeKind: runtime?.kind ?? 'none',
          },
          settings,
        )
      : {};

    const history = chat.messages;
    const instructionsTokens = estimateMessageTokens({
      id: 'instructions',
      role: 'system',
      parts: [{ type: 'text', text: this.instructions }],
    });
    const toolsTokens = estimateToolSchemaTokens(Object.keys(this.tools).length);
    const historyTokens = history.reduce((sum, message) => sum + estimateMessageTokens(message), 0);
    const estimatedTokens = instructionsTokens + toolsTokens + historyTokens;

    const routeRequest: RouteRequest = {
      requestedKey: this.deps.session.modelKey ?? '',
      hasImages: request.attachments.some((file) => file.kind === 'image'),
      hasDocuments: request.attachments.some((file) => file.kind === 'document'),
      hasAudio: request.attachments.some((file) => file.kind === 'audio'),
      needsTools: Object.keys(this.tools).length > 0,
      needsReasoning: settings.reasoningEffort !== null && settings.reasoningEffort !== 'off',
      estimatedTokens,
    };

    const appSettings = this.deps.appSettings();
    const records = this.deps.models();
    const requested = records.find((model) => model.key === routeRequest.requestedKey);
    const pool = requested ? sameProviderPool(records, requested) : records;
    const route = resolveRoute(pool, routeRequest, appSettings.autoRouteByCapability);

    if (!route.ok) {
      const failure = diagnose(new Error(route.reason));
      this.status({ phase: 'failed', note: route.reason, failure });
      this.deps.onNotify(route.reason, 'danger');
      return;
    }

    if (route.redirected && route.notice) {
      this.deps.onNotify(route.notice, 'info');
    }

    if (settings.workspaceEnabled && runtime?.runtime) {
      this.status({ phase: 'preparing', note: 'копируем файлы в песочницу' });
      const sync = await syncWorkspace(runtime.runtime, nodes);
      if (sync.skipped.length) {
        this.deps.onNotify(
          `Локальный режим не принимает бинарные файлы: ${sync.skipped.slice(0, 4).join(', ')}`,
          'warn',
        );
      }
    }

    const account = this.deps.account();
    if (!account) {
      const failure = diagnose(new Error('Провайдер этой модели отключён или ключ удалён'));
      this.status({ phase: 'failed', note: failure.message, failure });
      this.deps.onNotify(failure.message, 'danger');
      return;
    }

    const model = await createLanguageModel(
      account,
      splitModelKey(route.model.key).id,
      this.deps.policy(),
    );

    await this.maybeCompact(route.model, appSettings, instructionsTokens, toolsTokens);

    const live = this.chat?.messages ?? history;
    const liveEstimate =
      instructionsTokens +
      toolsTokens +
      live.reduce((sum, message) => sum + estimateMessageTokens(message), 0);

    const trimmed = this.applyBudget(live, route.model, instructionsTokens, toolsTokens);
    if (trimmed) chat.messages = trimmed;

    this.holder.set(
      new ToolLoopAgent({
        model,
        instructions: this.instructions,
        tools: this.tools,
        toolApproval: this.approvalConfig(settings.approvalRequired),
        stopWhen: stepCountIs(Math.max(1, settings.maxToolRounds)),
        maxRetries: 0,
        ...callSettingsFor(account.protocol, settings),
      }),
      this.tools,
    );

    this.deps.session.modelKey = route.model.key;
    const outboxId = await this.persistOutbox(request.text, request.attachments, route.model.key);

    this.beginTurn({
      model: route.model,
      outboxId,
      estimatedTokens: liveEstimate,
      instructionsTokens,
      toolsTokens,
    });

    this.status({ phase: 'streaming', note: route.model.name, attempt: 1 });
    this.startWatcher();

    await this.loop(() =>
      chat.sendMessage({ text: request.text, files: request.attachments.map(toFilePart) }),
    );
  }

  async regenerate(): Promise<void> {
    const chat = this.chat;
    const model = this.deps
      .models()
      .find((candidate) => candidate.key === this.deps.session.modelKey);

    if (!chat || this.turn || !this.holder.isReady || !model) {
      this.deps.onNotify('Нечего повторять: сначала отправьте сообщение', 'warn');
      return;
    }

    const outboxId = await this.persistOutbox('повтор ответа', [], this.deps.session.modelKey ?? '');

    this.beginTurn({
      model,
      outboxId,
      estimatedTokens: 0,
      instructionsTokens: 0,
      toolsTokens: 0,
    });

    this.status({ phase: 'streaming', note: 'повторяем ответ', attempt: 1 });
    this.startWatcher();

    await this.loop(() => chat.regenerate());
  }

  private approvalConfig(approvalRequired: boolean): ToolApprovalConfiguration<ToolSet, unknown> {
    const config: ToolApprovalConfiguration<ToolSet, unknown> = {};

    for (const name of Object.keys(this.tools)) {
      config[name] = approvalRequired && GATED_TOOLS.has(name) ? 'user-approval' : 'approved';
    }

    return config;
  }

  private fitBudget(
    model: ModelRecord,
    instructionsTokens: number,
    toolsTokens: number,
  ): FitBudget {
    return {
      contextWindow: model.limits.context,
      ratio: this.deps.session.tokenBudgetRatio,
      instructionsTokens,
      toolsTokens,
      reserveOutput: this.deps.session.settings.maxOutputTokens ?? OUTPUT_RESERVE_TOKENS,
    };
  }

  private applyBudget(
    messages: UIMessage[],
    model: ModelRecord,
    instructionsTokens: number,
    toolsTokens: number,
  ): UIMessage[] | null {
    const budget = this.fitBudget(model, instructionsTokens, toolsTokens);

    if (!Number.isFinite(budgetFor(budget))) return null;

    const plan = fitContext(messages, budget);
    if (plan.dropped === 0) return null;

    this.deps.onNotify(
      `${model.name}: контекст ${plan.estimated} из ${Math.round(budgetFor(budget))} токенов, убрано ${plan.dropped} ранних сообщений`,
      'info',
    );

    return messages.slice(plan.start);
  }

  private async allowBySpendCap(): Promise<boolean> {
    const cap = this.deps.session.spendCapUsd;
    if (cap === null || cap <= 0) return true;

    const spent = await spendOfChat(this.deps.session.id);
    const verdict = checkBudget(spent, cap);

    if (verdict.message) {
      this.deps.onNotify(verdict.message, verdict.allowed ? 'warn' : 'danger');
    }

    if (verdict.allowed) return true;

    const failure = diagnose(new Error(verdict.message ?? 'Лимит разговора исчерпан'));
    this.status({ phase: 'failed', note: failure.message, failure });

    return false;
  }

  private async maybeCompact(
    model: ModelRecord,
    settings: SettingsState,
    instructionsTokens: number,
    toolsTokens: number,
  ): Promise<void> {
    const chat = this.chat;
    const ratio = settings.autoCompactRatio;

    if (!chat || !ratio || ratio <= 0 || model.limits.context <= 0) return;
    if (chat.messages.length < COMPACT_KEEP_TAIL + COMPACT_MIN_HEAD) return;

    const budget = budgetFor(this.fitBudget(model, instructionsTokens, toolsTokens));

    if (!Number.isFinite(budget) || budget <= 0) return;

    const historyTokens = chat.messages.reduce(
      (sum, message) => sum + estimateMessageTokens(message),
      0,
    );

    if (historyTokens < budget * ratio) return;

    await this.compact();
  }

  async compact(): Promise<boolean> {
    const chat = this.chat;
    if (!chat || this.turn) return false;

    const { head, tail } = splitForCompaction(chat.messages, COMPACT_KEEP_TAIL);
    if (head.length < COMPACT_MIN_HEAD || !tail.length) return false;

    const model = await this.deps.auxiliary();

    if (!model) {
      this.deps.onNotify('Сжатие недоступно: выберите дешёвую модель в настройках', 'warn');
      return false;
    }

    this.status({ phase: 'preparing', note: 'сжимаю историю' });

    let digestText = '';

    try {
      const result = await summarizeHistory(head, model);
      digestText = result.digest;
    } catch (error) {
      const failure = diagnose(error);
      this.deps.onNotify(`Не удалось сжать историю: ${failure.message}`, 'warn');
    }

    if (!digestText) {
      this.status({ phase: 'idle' });
      return false;
    }

    const chatId = this.deps.session.id;
    const rows = await listMessages(chatId);
    const headIds = new Set(head.map((message) => message.id));
    const dropped = rows.filter((row) => headIds.has(row.id));
    const firstSeq = dropped.length ? dropped[0].seq : 0;
    const keptFrom =
      rows.find((row) => tail.some((message) => message.id === row.id))?.seq ??
      firstSeq + dropped.length;

    const digest = digestMessage(`d-${Date.now().toString(36)}`, digestText, dropped.length);
    const meta = emptyMessageMeta();

    await putMessages([
      {
        id: digest.id,
        chatId,
        seq: firstSeq,
        role: 'system',
        parts: digest.parts,
        meta: { ...meta, turn: { ...meta.turn, trimmedMessages: dropped.length } },
        createdAt: Date.now(),
      },
    ]);

    this.deps.session.compactedBefore = keptFrom;
    await putChat({ ...this.deps.session });
    this.deps.onSession({ ...this.deps.session });

    chat.messages = [digest, ...tail];
    this.deps.onMessages(chat.messages);

    this.deps.onNotify(
      `История сжата: ${dropped.length} сообщений заменены сводкой, в контексте ${tail.length} свежих`,
      'info',
    );

    this.status({ phase: 'idle' });

    return true;
  }

  private async maybeTitle(messages: UIMessage[]): Promise<void> {
    const session = this.deps.session;

    if (!this.deps.appSettings().autoTitle) return;
    if (session.titleSource === 'user' || session.titleSource === 'model') return;

    const model = await this.deps.auxiliary();
    if (!model) return;

    const title = await suggestTitle(messages, model);
    if (!title) return;

    session.title = title;
    session.titleSource = 'model';
    await putChat({ ...session });
    this.deps.onSession({ ...session });
    this.deps.onTitle(title);
  }

  private async persistOutbox(
    text: string,
    attachments: Attachment[],
    modelKey: string,
  ): Promise<string> {
    const chatId = this.deps.session.id;
    const seq = await nextSequence(chatId);
    return this.writeOutbox(`p-${seq}-${chatId.slice(0, 6)}`, text, attachments, modelKey);
  }

  private async writeOutbox(
    messageId: string,
    text: string,
    attachments: Attachment[],
    modelKey: string,
  ): Promise<string> {
    const now = Date.now();
    const id = `o-${messageId}`;

    await putOutbox({
      id,
      chatId: this.deps.session.id,
      messageId,
      text,
      attachments,
      modelKey,
      settings: this.deps.session.settings,
      attempts: 0,
      state: 'in-flight',
      createdAt: now,
      updatedAt: now,
      lastError: null,
    });

    return id;
  }

  private beginTurn(fields: {
    model: ModelRecord;
    outboxId: string;
    estimatedTokens: number;
    instructionsTokens: number;
    toolsTokens: number;
  }): TurnState {
    const now = Date.now();
    const turn: TurnState = {
      model: fields.model,
      outboxId: fields.outboxId,
      startedAt: now,
      attempts: 1,
      trimmed: 0,
      estimatedTokens: fields.estimatedTokens,
      instructionsTokens: fields.instructionsTokens,
      toolsTokens: fields.toolsTokens,
      firstProgressAt: null,
      lastProgressAt: now,
      settled: false,
      outcome: null,
      settle: () => undefined,
    };

    this.turn = turn;
    return turn;
  }

  private async loop(launch: () => Promise<void>): Promise<void> {
    const turn = this.turn;
    if (!turn) return;

    for (;;) {
      const outcome = await this.dispatch(launch);

      if (outcome.kind === 'finished') {
        this.stopWatcher();
        await this.closeTurn(outcome.messages, outcome.aborted ? 'aborted' : 'settled', null);
        this.reportUsage(outcome.messages, turn);
        this.status({ phase: 'idle', elapsedMs: Date.now() - turn.startedAt });
        this.turn = null;
        return;
      }

      if (outcome.kind === 'approval') {
        await this.persist(outcome.messages, 'settled', null, null);
        this.status({
          phase: 'awaiting-approval',
          note: 'жду разрешения',
          attempt: turn.attempts,
          approval: outcome.pending,
          elapsedMs: Date.now() - turn.startedAt,
        });
        return;
      }

      const failure = diagnose(outcome.error);

      if (failure.kind === 'aborted') {
        this.stopWatcher();
        await this.closeTurn(this.chat?.messages ?? [], 'aborted', null);
        this.status({ phase: 'idle', note: 'остановлено вручную' });
        this.turn = null;
        return;
      }

      const recovery = planRecovery({
        diagnosis: failure,
        attempt: turn.attempts,
        maxRetries: this.deps.appSettings().maxRetries,
        retryBaseMs: this.deps.appSettings().retryBaseMs,
        canTrim: this.chat !== null,
        trimmedAlready: turn.trimmed,
        waitMs:
          failure.retryAfterMs ??
          backoffDelay({ baseMs: this.deps.appSettings().retryBaseMs, attempt: turn.attempts }),
      });

      if (recovery.kind === 'give-up') {
        this.stopWatcher();
        await this.closeTurn(this.chat?.messages ?? [], 'failed', failure);
        this.status({ phase: 'failed', note: recovery.note, failure, attempt: turn.attempts });
        this.deps.onNotify(recovery.note, 'danger');
        this.turn = null;
        return;
      }

      turn.attempts += 1;
      this.status({
        phase: 'retrying',
        note: `${recovery.note} — ${describeAttempt(turn.attempts, this.deps.appSettings().maxRetries)}`,
        attempt: turn.attempts,
        failure,
      });

      if (recovery.trim) {
        this.trimTurnHistory(turn);
      }

      await delay(recovery.waitMs);
      turn.lastProgressAt = Date.now();
      turn.firstProgressAt = null;
      this.startWatcher();
    }
  }

  private trimTurnHistory(turn: TurnState): void {
    const chat = this.chat;
    if (!chat) return;

    const history = chat.messages;
    const fitted = this.applyBudget(history, turn.model, turn.instructionsTokens, turn.toolsTokens);

    chat.messages =
      fitted && fitted.length < history.length
        ? fitted
        : history.slice(Math.max(0, history.length - 6));

    turn.trimmed += 1;
  }

  private dispatch(launch: () => Promise<void>): Promise<TurnOutcome> {
    const turn = this.turn;

    return new Promise<TurnOutcome>((resolve) => {
      if (!turn) {
        resolve({ kind: 'error', error: new Error('Ход не начат') });
        return;
      }

      turn.settle = resolve;

      launch().catch((error: unknown) => {
        this.complete(null, false, error instanceof Error ? error : new Error(String(error)));
      });
    });
  }

  private complete(messages: UIMessage[] | null, isAbort: boolean, error?: Error): void {
    const turn = this.turn;
    if (!turn || turn.settled) return;
    turn.settled = true;

    if (error) {
      turn.outcome = { kind: 'error', error };
      turn.settle(turn.outcome);
      return;
    }

    const current = messages ?? this.chat?.messages ?? [];
    const pending = findPendingApproval(current);

    turn.settled = false;
    turn.outcome = pending
      ? { kind: 'approval', messages: current, pending }
      : { kind: 'finished', messages: current, aborted: isAbort };

    turn.settle(turn.outcome);
  }

  private reportUsage(messages: UIMessage[], turn: TurnState): void {
    const usage = usageOf(messages[messages.length - 1], turn.model);
    if (!usage) return;

    this.deps.onUsage({
      ...usage,
      modelKey: turn.model.key,
      timeToFirstChunkMs:
        turn.firstProgressAt === null ? null : turn.firstProgressAt - turn.startedAt,
      attempts: turn.attempts,
    });
  }

  private startWatcher(): void {
    this.stopWatcher();
    this.lastSignature = '';
    const intervalMs = Math.max(1_000, this.deps.appSettings().keepAlivePingMs);
    this.lastSignature = this.signature();
    let signature = this.lastSignature;

    this.watcher = setInterval(() => {
      const turn = this.turn;
      if (!turn) return;

      const current = this.signature();
      const now = Date.now();

      if (current !== signature) {
        signature = current;
        this.lastSignature = current;
        turn.lastProgressAt = now;
        if (turn.firstProgressAt === null) turn.firstProgressAt = now;
        this.emitProgress();
        return;
      }

      const silentMs = now - turn.lastProgressAt;
      const limitMs = turn.firstProgressAt === null ? 60_000 : 120_000;

      if (silentMs > limitMs && this.chat?.status === 'streaming') {
        void this.chat?.stop();
        this.complete(
          null,
          false,
          new Error(
            turn.firstProgressAt === null
              ? 'Провайдер не прислал первый байт за минуту'
              : `Поток замер: ${Math.round(silentMs / 1_000)} секунд без новых данных`,
          ),
        );
      }
    }, intervalMs);
  }

  private stopWatcher(): void {
    if (this.watcher) clearInterval(this.watcher);
    this.watcher = null;
  }

  private emitProgress(): void {
    const messages = this.chat?.messages ?? [];
    this.deps.onMessages(messages);

    const pending = findPendingApproval(messages);
    if (pending) {
      this.status({ phase: 'awaiting-approval', note: pending.toolName, approval: pending });
    }
  }

  private signature(): string {
    const messages = this.chat?.messages ?? [];
    const last = messages[messages.length - 1];
    if (!last) return `${messages.length}:empty`;

    const size = last.parts.reduce((sum, part) => sum + JSON.stringify(part).length, 0);
    return `${messages.length}:${last.id}:${last.parts.length}:${size}`;
  }

  approve(approvalId: string, approved: boolean, reason?: string): void {
    const turn = this.turn;
    this.chat?.addToolApprovalResponse({ id: approvalId, approved, reason });

    if (turn) {
      turn.lastProgressAt = Date.now();
      turn.settled = false;
    }

    this.status({ phase: 'streaming', note: approved ? 'разрешено, продолжаем' : 'отклонено' });
  }

  async stop(): Promise<void> {
    this.stopWatcher();
    await this.chat?.stop();
  }

  applySession(changes: Partial<ChatSession>): void {
    Object.assign(this.deps.session, changes);
  }

  private status(partial: Partial<SessionStatus>): void {
    const previous = this.turn
      ? { attempt: this.turn.attempts, elapsedMs: Date.now() - this.turn.startedAt }
      : { attempt: 0, elapsedMs: 0 };

    this.deps.onStatus({ ...idleStatus(), ...previous, ...partial });
  }

  private async closeTurn(
    messages: UIMessage[],
    status: 'settled' | 'aborted' | 'failed',
    failure: ErrorDiagnosis | null,
  ): Promise<void> {
    const model = this.turn?.model;
    const usage = model ? usageOf(messages[messages.length - 1], model) : null;
    await this.persist(messages, status, failure, usage);

    const turn = this.turn;
    if (turn?.outboxId) {
      await deleteOutbox(turn.outboxId);
      turn.outboxId = '';
    }

    if (status === 'settled') {
      await this.maybeTitle(messages);
    }
  }

  private async persist(
    messages: UIMessage[],
    status: 'settled' | 'aborted' | 'failed',
    failure: ErrorDiagnosis | null,
    usage: UsageRecord | null,
  ): Promise<void> {
    const chatId = this.deps.session.id;
    const rows = await listMessages(chatId);
    const byId = new Map(rows.map((row) => [row.id, row]));
    let seq = rows.length ? rows[rows.length - 1].seq + 1 : 0;
    const turn = this.turn;
    const now = Date.now();

    for (const message of messages) {
      const existing = byId.get(message.id);
      const isAssistant = message.role !== 'user';

      if (existing) {
        byId.set(message.id, {
          ...existing,
          parts: message.parts,
          meta: {
            ...existing.meta,
            turn: {
              ...existing.meta.turn,
              status: isAssistant ? status : 'settled',
              attempts: isAssistant
                ? [
                    ...existing.meta.turn.attempts,
                    {
                      at: now,
                      modelKey: turn?.model.key ?? existing.meta.turn.route?.modelKey ?? '',
                      outcome:
                        status === 'failed' ? 'error' : status === 'aborted' ? 'aborted' : 'ok',
                      status: failure?.status ?? undefined,
                      message: failure?.message,
                      durationMs: turn ? now - turn.startedAt : 0,
                    },
                  ]
                : existing.meta.turn.attempts,
              usage: usage ?? existing.meta.turn.usage,
              trimmedMessages: turn?.trimmed ?? existing.meta.turn.trimmedMessages,
              estimatedTokens: turn?.estimatedTokens ?? existing.meta.turn.estimatedTokens,
              contextWindow: turn?.model.limits.context ?? existing.meta.turn.contextWindow,
              errorText: isAssistant ? failure?.message ?? null : existing.meta.turn.errorText,
              errorCode: isAssistant ? failure?.kind ?? null : existing.meta.turn.errorCode,
              settledAt: isAssistant ? now : existing.meta.turn.settledAt,
            },
          },
        });
        continue;
      }

      const meta = emptyMessageMeta();
      byId.set(message.id, {
        id: message.id,
        chatId,
        seq: seq++,
        role: message.role,
        parts: message.parts,
        meta: {
          ...meta,
          turn: {
            ...meta.turn,
            status: isAssistant ? status : 'settled',
            usage: isAssistant ? usage : null,
            estimatedTokens: isAssistant ? turn?.estimatedTokens ?? 0 : 0,
            contextWindow: isAssistant ? turn?.model.limits.context ?? 0 : 0,
            trimmedMessages: isAssistant ? turn?.trimmed ?? 0 : 0,
            errorText: isAssistant ? failure?.message ?? null : null,
            errorCode: isAssistant ? failure?.kind ?? null : null,
            createdAt: now,
            settledAt: now,
          },
        },
        createdAt: now,
      });
    }

    await putMessages([...byId.values()]);

    if (usage && turn) {
      await recordSpend({ chatId, modelKey: turn.model.key, at: now, usage });
    }
  }

  async dispose(): Promise<void> {
    this.stopWatcher();
    await this.stop();

    if (this.runtime?.kind === 'webcontainer') {
      await this.runtime.runtime.stop();
    }

    this.chat = null;
    this.turn = null;
  }
}

function toFilePart(attachment: Attachment): FileUIPart {
  return {
    type: 'file',
    mediaType: attachment.mediaType,
    url: attachment.dataUrl,
    filename: attachment.name,
  };
}

function usageOf(message: UIMessage | undefined, model: ModelRecord): UsageRecord | null {
  if (!message) return null;

  const metadata = message.metadata as { usage?: Partial<UsageRecord> } | undefined;
  const raw = metadata?.usage;
  if (!raw || (raw.inputTokens === undefined && raw.outputTokens === undefined)) return null;

  const usage: UsageRecord = {
    ...emptyUsage(),
    inputTokens: raw.inputTokens ?? 0,
    outputTokens: raw.outputTokens ?? 0,
    reasoningTokens: raw.reasoningTokens ?? 0,
    cachedInputTokens: raw.cachedInputTokens ?? 0,
    durationMs: raw.durationMs ?? 0,
  };

  return { ...usage, costUsd: estimateUsageCost(usage, model.cost) };
}
