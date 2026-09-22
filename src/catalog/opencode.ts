import type { CapabilityPatch } from '../core/capabilities';
import {
  CUSTOM_PROVIDER_ID,
  hostOfUrl,
  presetById,
  sortedPresets,
  trimmedBaseUrl,
  type AccountDraft,
} from '../core/providers';
import type {
  ModelRecord,
  ProviderAccount,
  ProviderPreset,
  TransportProtocol,
} from '../core/types';
import type { DiscoveredModel } from './discovery';

export const OPENCODE_SCHEMA = 'https://opencode.ai/config.json';
export const OPENCODE_FILE_NAME = 'opencode.json';

interface OpencodeOptions {
  baseURL?: string;
  apiKey?: string;
  headers?: Record<string, string>;
  timeout?: number;
  setCacheKey?: boolean;
}

interface OpencodeModelEntry {
  name?: string;
  limit?: { context?: number; output?: number };
  attachment?: boolean;
  reasoning?: boolean;
  tool_call?: boolean;
  temperature?: boolean;
  knowledge?: string;
  release_date?: string;
  cost?: {
    input?: number;
    output?: number;
    cache_read?: number;
    cache_write?: number;
    reasoning?: number;
  };
  options?: {
    thinking?: { type?: string; budgetTokens?: number };
    reasoningEffort?: string;
    textVerbosity?: string;
    maxOutputTokens?: number;
    temperature?: number;
    topP?: number;
  };
}

interface OpencodeProviderEntry {
  npm?: string;
  name?: string;
  options?: OpencodeOptions;
  models?: Record<string, OpencodeModelEntry>;
  whitelist?: string[];
  blacklist?: string[];
}

interface OpencodeConfig {
  $schema?: string;
  provider?: Record<string, OpencodeProviderEntry>;
  model?: string;
}

export interface OpencodeProfile {
  draft: AccountDraft;
  models: DiscoveredModel[];
  notices: string[];
}

export interface OpencodeImport {
  profiles: OpencodeProfile[];
  notices: string[];
}

const PROTOCOL_BY_NPM: Record<string, TransportProtocol> = {
  '@ai-sdk/openai-compatible': 'openai-chat',
  '@ai-sdk/openai': 'openai-chat',
  '@ai-sdk/anthropic': 'anthropic',
  '@ai-sdk/google': 'google',
  '@ai-sdk/google-vertex': 'google',
  '@ai-sdk/groq': 'openai-chat',
  '@ai-sdk/deepseek': 'openai-chat',
  '@ai-sdk/mistral': 'openai-chat',
  '@ai-sdk/xai': 'openai-chat',
  '@ai-sdk/openrouter': 'openai-chat',
  '@ai-sdk/ollama': 'openai-chat',
  '@ai-sdk/azure': 'openai-chat',
};

const positive = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;

export function matchesGlob(value: string, pattern: string): boolean {
  const source = pattern
    .split('*')
    .map((chunk) => chunk.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');

  return new RegExp(`^${source}$`, 'i').test(value);
}

function presetFor(id: string, baseUrl: string): ProviderPreset | undefined {
  const key = id.trim().toLowerCase();

  const byId = presetById(key);
  if (byId) return byId;

  const byName = sortedPresets().find((preset) => preset.name.toLowerCase() === key);
  if (byName) return byName;

  const host = hostOfUrl(baseUrl);
  if (!host) return undefined;

  return sortedPresets().find((preset) => hostOfUrl(preset.baseUrl) === host);
}

function protocolOf(entry: OpencodeProviderEntry, preset: ProviderPreset | undefined, baseUrl: string): TransportProtocol {
  if (/\/responses\/?$/.test(trimmedBaseUrl(baseUrl))) return 'openai-responses';
  if (preset) return preset.protocol;

  const npm = entry.npm?.trim() ?? '';

  return PROTOCOL_BY_NPM[npm] ?? 'openai-chat';
}

export function resolveApiKey(value: unknown): { key: string; notice: string | null } {
  const raw = typeof value === 'string' ? value.trim() : '';

  if (!raw) {
    return { key: '', notice: 'ключ в профиле не указан — впишите его при подключении' };
  }

  const env = /^\{env:([^}]+)\}$/i.exec(raw);
  if (env) {
    return {
      key: '',
      notice: `ключ берётся из переменной ${env[1]} — браузер не читает окружение, впишите значение вручную`,
    };
  }

  const file = /^\{file:([^}]+)\}$/i.exec(raw);
  if (file) {
    return { key: '', notice: `ключ читается из файла ${file[1]} — впишите значение вручную` };
  }

  return { key: raw, notice: null };
}

function modelOf(id: string, entry: OpencodeModelEntry): DiscoveredModel {
  const patch: CapabilityPatch = {};

  const context = positive(entry.limit?.context);
  const output = positive(entry.limit?.output) ?? positive(entry.options?.maxOutputTokens);

  if (context) patch.context = context;
  if (output) patch.output = output;

  if (typeof entry.attachment === 'boolean') {
    patch.attachment = entry.attachment;
    if (entry.attachment) patch.inputModalities = ['text', 'image', 'pdf', 'file'];
  }

  if (typeof entry.tool_call === 'boolean') patch.toolCall = entry.tool_call;
  if (typeof entry.temperature === 'boolean') patch.temperature = entry.temperature;

  if (entry.options?.thinking?.type === 'enabled' || entry.options?.reasoningEffort) {
    patch.reasoning = true;
  } else if (typeof entry.reasoning === 'boolean') {
    patch.reasoning = entry.reasoning;
  }

  const cost = entry.cost;
  const costInput = positive(cost?.input);
  const costOutput = positive(cost?.output);
  const cacheRead = positive(cost?.cache_read);
  const cacheWrite = positive(cost?.cache_write);
  const reasoning = positive(cost?.reasoning);

  if (costInput !== undefined) patch.costInput = costInput;
  if (costOutput !== undefined) patch.costOutput = costOutput;
  if (cacheRead !== undefined) patch.costCacheRead = cacheRead;
  if (cacheWrite !== undefined) patch.costCacheWrite = cacheWrite;
  if (reasoning !== undefined) patch.costReasoning = reasoning;

  return { id, name: entry.name?.trim() || null, patch, deprecated: false };
}

function allowedModels(entry: OpencodeProviderEntry): [string, OpencodeModelEntry][] {
  const models = Object.entries(entry.models ?? {});
  const whitelist = entry.whitelist ?? [];
  const blacklist = entry.blacklist ?? [];

  return models.filter(([id]) => {
    if (whitelist.length && !whitelist.some((pattern) => matchesGlob(id, pattern))) return false;
    return !blacklist.some((pattern) => matchesGlob(id, pattern));
  });
}

function profileOf(key: string, entry: OpencodeProviderEntry): OpencodeProfile {
  const notices: string[] = [];
  const preset = presetFor(key, entry.options?.baseURL ?? '');
  const baseUrl = trimmedBaseUrl(entry.options?.baseURL ?? preset?.baseUrl ?? '');

  if (!baseUrl) {
    notices.push('нет адреса сервера — укажите baseURL в профиле или в форме подключения');
  }

  const protocol = protocolOf(entry, preset, baseUrl);
  const keyInfo = resolveApiKey(entry.options?.apiKey);
  if (keyInfo.notice) notices.push(keyInfo.notice);

  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(entry.options?.headers ?? {})) {
    if (typeof value === 'string') headers[name] = value;
  }

  const models = allowedModels(entry).map(([id, model]) => modelOf(id, model));

  if (!models.length) {
    notices.push('список моделей пуст — подтянем его запросом к провайдеру');
  }

  const draft: AccountDraft = {
    presetId: preset?.id ?? CUSTOM_PROVIDER_ID,
    label: entry.name?.trim() || preset?.name || hostOfUrl(baseUrl) || key,
    apiKey: keyInfo.key,
    baseUrl,
    protocol,
    headers,
    route: hostOfUrl(baseUrl).startsWith('localhost') || hostOfUrl(baseUrl).startsWith('127.') ? 'direct' : undefined,
    opencode: true,
  };

  return { draft, models, notices };
}

export function parseOpencodeConfig(text: string): OpencodeImport {
  const notices: string[] = [];

  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return {
      profiles: [],
      notices: [`Файл не читается как JSON: ${error instanceof Error ? error.message : String(error)}`],
    };
  }

  if (!parsed || typeof parsed !== 'object') {
    return { profiles: [], notices: ['Ожидался объект конфигурации opencode.json'] };
  }

  const config = parsed as OpencodeConfig;
  const providers = config.provider;

  if (!providers || typeof providers !== 'object') {
    return {
      profiles: [],
      notices: ['В файле нет секции provider — подключать нечего'],
    };
  }

  const profiles = Object.entries(providers)
    .filter(([, entry]) => entry && typeof entry === 'object')
    .map(([key, entry]) => profileOf(key, entry));

  if (!profiles.length) notices.push('Секция provider пуста');

  return { profiles, notices };
}

const NPM_BY_PROTOCOL: Record<TransportProtocol, string> = {
  'openai-chat': '@ai-sdk/openai-compatible',
  'openai-responses': '@ai-sdk/openai',
  anthropic: '@ai-sdk/anthropic',
  google: '@ai-sdk/google',
};

const slugOf = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'provider';

export function providerKeyOf(account: ProviderAccount): string {
  if (account.presetId !== CUSTOM_PROVIDER_ID) return account.presetId;

  const host = hostOfUrl(account.baseUrl);

  return host ? slugOf(host.replace(/^www\./, '')) : 'custom';
}

export function npmOf(account: ProviderAccount): string {
  if (account.protocol === 'openai-chat' && account.presetId === 'openai') return '@ai-sdk/openai';

  return NPM_BY_PROTOCOL[account.protocol];
}

export const envVarName = (account: ProviderAccount): string =>
  `PULT_${providerKeyOf(account).toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`;

export interface OpencodeExportOptions {
  includeKeys?: boolean;
  defaultModelKey?: string | null;
}

function modelEntryOf(record: ModelRecord): OpencodeModelEntry {
  const entry: OpencodeModelEntry = {};

  if (record.name && record.name !== record.id) entry.name = record.name;

  const context = positive(record.limits.context);
  const output = positive(record.limits.output);
  if (context || output) entry.limit = { ...(context ? { context } : {}), ...(output ? { output } : {}) };

  if (record.capabilities.attachment) entry.attachment = true;
  if (record.capabilities.reasoning) entry.reasoning = true;
  if (record.capabilities.toolCall) entry.tool_call = true;
  if (record.capabilities.temperature) entry.temperature = true;

  const cost = record.cost;
  if (positive(cost.input) !== undefined || positive(cost.output) !== undefined) {
    entry.cost = {
      ...(positive(cost.input) !== undefined ? { input: cost.input } : {}),
      ...(positive(cost.output) !== undefined ? { output: cost.output } : {}),
      ...(positive(cost.cacheRead) !== undefined ? { cache_read: cost.cacheRead } : {}),
      ...(positive(cost.cacheWrite) !== undefined ? { cache_write: cost.cacheWrite } : {}),
      ...(positive(cost.reasoning) !== undefined ? { reasoning: cost.reasoning } : {}),
    };
  }

  if (record.knowledge) entry.knowledge = record.knowledge;

  return entry;
}

export function opencodeConfigOf(
  accounts: ProviderAccount[],
  models: ModelRecord[],
  options: OpencodeExportOptions = {},
): string {
  const exported = accounts.filter((account) => account.opencode);
  const provider: Record<string, OpencodeProviderEntry> = {};
  const keyByModel = new Map(models.map((record) => [record.key, record]));

  for (const account of exported) {
    const owned = models.filter((record) => record.providerId === account.id);
    const providerOptions: OpencodeOptions = {
      baseURL: accountBaseUrlOf(account),
      apiKey: options.includeKeys ? account.apiKey : `{env:${envVarName(account)}}`,
    };

    const extraHeaders = presetById(account.presetId)?.extraHeaders ?? {};
    const headers = Object.fromEntries(
      Object.entries(account.headers).filter(([name, value]) => extraHeaders[name] !== value),
    );

    if (Object.keys(headers).length) providerOptions.headers = headers;

    const entry: OpencodeProviderEntry = {
      npm: npmOf(account),
      name: account.label,
      options: providerOptions,
    };

    if (owned.length) {
      entry.models = Object.fromEntries(owned.map((record) => [record.id, modelEntryOf(record)]));
    }

    provider[providerKeyOf(account)] = entry;
  }

  const config: OpencodeConfig = { $schema: OPENCODE_SCHEMA, provider };

  const defaultModel = options.defaultModelKey ? keyByModel.get(options.defaultModelKey) : undefined;

  if (defaultModel) {
    const owner = exported.find((account) => account.id === defaultModel.providerId);
    if (owner) config.model = `${providerKeyOf(owner)}/${defaultModel.id}`;
  }

  return `${JSON.stringify(config, null, 2)}\n`;
}

const accountBaseUrlOf = (account: ProviderAccount): string => trimmedBaseUrl(account.baseUrl);
