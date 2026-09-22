import { nanoid } from 'nanoid';
import type { LanguageModel } from 'ai';
import { proxyUrl } from '../../server/target';
import type {
  DiscoverySpec,
  ProviderAccount,
  ProviderPreset,
  ProviderRoute,
  TransportProtocol,
} from './types';

export interface ModelFactoryOptions {
  apiKey: string;
  baseURL: string;
  headers?: Record<string, string>;
  name: string;
}

export type ModelFactory = (modelId: string, options: ModelFactoryOptions) => LanguageModel;

export const ANTHROPIC_VERSION = '2023-06-01';

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'openrouter',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    protocol: 'openai-chat',
    auth: { scheme: 'bearer' },
    discovery: { kind: 'openai-models', path: '/models' },
    catalogId: 'openrouter',
    browserDirect: true,
    browserNote: 'Отдаёт Access-Control-Allow-Origin: * — ключ живёт только в вашем браузере.',
    docsUrl: 'https://openrouter.ai/docs',
    keysUrl: 'https://openrouter.ai/settings/keys',
    keyHint: 'sk-or-v1-…',
    accent: '#f0f1f2',
    order: 1,
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    protocol: 'anthropic',
    auth: { scheme: 'api-key-header', header: 'x-api-key' },
    discovery: { kind: 'anthropic-models', path: '/models' },
    catalogId: 'anthropic',
    browserDirect: true,
    browserNote: 'Браузерный доступ открывается заголовком anthropic-dangerous-direct-browser-access.',
    extraHeaders: {
      'anthropic-version': ANTHROPIC_VERSION,
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    docsUrl: 'https://docs.anthropic.com/en/api/messages',
    keysUrl: 'https://console.anthropic.com/settings/keys',
    keyHint: 'sk-ant-api03-…',
    accent: '#c15f3c',
    order: 2,
  },
  {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    protocol: 'openai-chat',
    auth: { scheme: 'bearer' },
    discovery: { kind: 'openai-models', path: '/models' },
    catalogId: 'openai',
    browserDirect: true,
    browserNote: 'Ответы провайдера содержат Access-Control-Allow-Origin: *.',
    docsUrl: 'https://platform.openai.com/docs/api-reference',
    keysUrl: 'https://platform.openai.com/api-keys',
    keyHint: 'sk-…',
    accent: '#10a37f',
    order: 3,
  },
  {
    id: 'google',
    name: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    protocol: 'google',
    auth: { scheme: 'query-key', queryParam: 'key' },
    discovery: { kind: 'google-models', path: '/models' },
    catalogId: 'google',
    browserDirect: true,
    browserNote: 'Зеркалит Origin в CORS-заголовке; ключ передаётся параметром key, как в AI Studio.',
    docsUrl: 'https://ai.google.dev/api',
    keysUrl: 'https://aistudio.google.com/app/apikey',
    keyHint: 'AIza…',
    accent: '#4285f4',
    order: 4,
  },
  {
    id: 'groq',
    name: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    protocol: 'openai-chat',
    auth: { scheme: 'bearer' },
    discovery: { kind: 'openai-models', path: '/models' },
    catalogId: 'groq',
    browserDirect: true,
    docsUrl: 'https://console.groq.com/docs/api-reference',
    keysUrl: 'https://console.groq.com/keys',
    keyHint: 'gsk_…',
    accent: '#f55036',
    order: 5,
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    protocol: 'openai-chat',
    auth: { scheme: 'bearer' },
    discovery: { kind: 'openai-models', path: '/models' },
    catalogId: 'deepseek',
    browserDirect: true,
    docsUrl: 'https://api-docs.deepseek.com',
    keysUrl: 'https://platform.deepseek.com/api_keys',
    keyHint: 'sk-…',
    accent: '#4d6bfe',
    order: 6,
  },
  {
    id: 'xai',
    name: 'xAI Grok',
    baseUrl: 'https://api.x.ai/v1',
    protocol: 'openai-chat',
    auth: { scheme: 'bearer' },
    discovery: { kind: 'openai-models', path: '/models' },
    catalogId: 'xai',
    browserDirect: true,
    docsUrl: 'https://docs.x.ai/docs/api-reference',
    keysUrl: 'https://console.x.ai',
    keyHint: 'xai-…',
    accent: '#9aa4ad',
    order: 7,
  },
  {
    id: 'mistral',
    name: 'Mistral',
    baseUrl: 'https://api.mistral.ai/v1',
    protocol: 'openai-chat',
    auth: { scheme: 'bearer' },
    discovery: { kind: 'openai-models', path: '/models' },
    catalogId: 'mistral',
    browserDirect: true,
    docsUrl: 'https://docs.mistral.ai/api',
    keysUrl: 'https://console.mistral.ai/api-keys',
    accent: '#fa520f',
    order: 8,
  },
  {
    id: 'zai',
    name: 'Z.ai',
    baseUrl: 'https://api.z.ai/api/paas/v4',
    protocol: 'openai-chat',
    auth: { scheme: 'bearer' },
    discovery: { kind: 'openai-models', path: '/models' },
    catalogId: 'zai',
    browserDirect: true,
    docsUrl: 'https://docs.z.ai',
    keysUrl: 'https://z.ai/manage-apikey/apikey-list',
    accent: '#7a5cff',
    order: 9,
  },
  {
    id: 'nebius',
    name: 'Nebius AI Studio',
    baseUrl: 'https://api.studio.nebius.com/v1',
    protocol: 'openai-chat',
    auth: { scheme: 'bearer' },
    discovery: { kind: 'openai-models', path: '/models' },
    catalogId: 'nebius',
    browserDirect: true,
    docsUrl: 'https://nebius.com/docs',
    keysUrl: 'https://studio.nebius.com',
    accent: '#ffd84d',
    order: 10,
  },
  {
    id: 'ollama',
    name: 'Ollama (локально)',
    baseUrl: 'http://localhost:11434/v1',
    protocol: 'openai-chat',
    auth: { scheme: 'bearer' },
    discovery: { kind: 'openai-models', path: '/models' },
    browserDirect: true,
    optionalKey: true,
    browserNote:
      'Локальный сервер должен разрешать запросы из браузера: запустите с OLLAMA_ORIGINS=*',
    docsUrl: 'https://docs.ollama.com/api',
    keysUrl: 'https://ollama.com/download',
    keyHint: 'Ключ не нужен — впишите любое значение, например ollama',
    accent: '#e6e1d6',
    order: 11,
  },
  {
    id: 'lmstudio',
    name: 'LM Studio (локально)',
    baseUrl: 'http://127.0.0.1:1234/v1',
    protocol: 'openai-chat',
    auth: { scheme: 'bearer' },
    discovery: { kind: 'openai-models', path: '/models' },
    browserDirect: true,
    optionalKey: true,
    browserNote: 'Включите CORS в настройках локального сервера LM Studio',
    docsUrl: 'https://lmstudio.ai/docs/app',
    keysUrl: 'https://lmstudio.ai',
    keyHint: 'Ключ не нужен — впишите любое значение, например lm-studio',
    accent: '#7aa2f7',
    order: 12,
  },
];

export const CUSTOM_PROVIDER_ID = 'custom';

export const presetById = (id: string): ProviderPreset | undefined =>
  PROVIDER_PRESETS.find((preset) => preset.id === id);

export const sortedPresets = (): ProviderPreset[] =>
  [...PROVIDER_PRESETS].sort((left, right) => left.order - right.order);

export const trimmedBaseUrl = (value: string): string => value.trim().replace(/\/+$/, '');

export const hostOfUrl = (value: string): string => {
  try {
    return new URL(trimmedBaseUrl(value)).host.toLowerCase();
  } catch {
    return '';
  }
};

export const accountBaseUrl = (account: ProviderAccount): string =>
  trimmedBaseUrl(account.baseUrl);

export interface AccountDraft {
  presetId: string;
  label: string;
  apiKey: string;
  baseUrl?: string;
  protocol?: TransportProtocol;
  headers?: Record<string, string>;
  route?: ProviderRoute;
  catalogId?: string | null;
  discovery?: DiscoverySpec;
  browserDirect?: boolean;
  opencode?: boolean;
}

export function createAccount(draft: AccountDraft): ProviderAccount {
  const preset = presetById(draft.presetId);
  const baseUrl = trimmedBaseUrl(draft.baseUrl ?? preset?.baseUrl ?? '');
  const protocol = draft.protocol ?? preset?.protocol ?? 'openai-chat';
  const headers = { ...(preset?.extraHeaders ?? {}), ...(draft.headers ?? {}) };

  return {
    id: nanoid(10),
    presetId: draft.presetId,
    label: draft.label.trim() || preset?.name || baseUrl,
    apiKey: draft.apiKey.trim(),
    baseUrl,
    protocol,
    headers,
    catalogId: draft.catalogId ?? preset?.catalogId ?? null,
    discovery: draft.discovery ?? preset?.discovery ?? { kind: 'none' },
    browserDirect: draft.browserDirect ?? preset?.browserDirect ?? false,
    route: draft.route ?? (preset?.browserDirect ? 'direct' : 'proxy'),
    opencode: draft.opencode ?? false,
    enabled: true,
    addedAt: Date.now(),
    lastCheckedAt: null,
    lastStatus: 'unknown',
    lastError: null,
  };
}

const adapterCache = new Map<TransportProtocol, Promise<ModelFactory>>();

async function loadAdapter(protocol: TransportProtocol): Promise<ModelFactory> {
  const cached = adapterCache.get(protocol);
  if (cached) return cached;

  const pending = buildAdapter(protocol);
  adapterCache.set(protocol, pending);
  return pending;
}

async function buildAdapter(protocol: TransportProtocol): Promise<ModelFactory> {
  switch (protocol) {
    case 'anthropic': {
      const { createAnthropic } = await import('@ai-sdk/anthropic');
      return (modelId, options) =>
        createAnthropic({
          apiKey: options.apiKey,
          baseURL: options.baseURL,
          headers: options.headers,
        })(modelId);
    }
    case 'google': {
      const { createGoogleGenerativeAI } = await import('@ai-sdk/google');
      return (modelId, options) =>
        createGoogleGenerativeAI({
          apiKey: options.apiKey,
          baseURL: options.baseURL,
          headers: options.headers,
        })(modelId);
    }
    case 'openai-responses': {
      const { createOpenAI } = await import('@ai-sdk/openai');
      return (modelId, options) =>
        createOpenAI({
          name: options.name,
          apiKey: options.apiKey,
          baseURL: options.baseURL,
          headers: options.headers,
        }).responses(modelId);
    }
    case 'openai-chat': {
      const { createOpenAICompatible } = await import('@ai-sdk/openai-compatible');
      return (modelId, options) =>
        createOpenAICompatible({
          name: options.name,
          apiKey: options.apiKey,
          baseURL: options.baseURL,
          headers: options.headers,
        })(modelId);
    }
  }
}

export interface EndpointPolicy {
  backendUrl: string;
  backendReady: boolean;
  route: 'auto' | ProviderRoute;
}

export const directPolicy = (): EndpointPolicy => ({
  backendUrl: '',
  backendReady: false,
  route: 'direct',
});

export interface Endpoint {
  baseURL: string;
  viaProxy: boolean;
  reason: string | null;
}

export function endpointFor(account: ProviderAccount, policy: EndpointPolicy = directPolicy()): Endpoint {
  const direct = accountBaseUrl(account);
  if (!direct) return { baseURL: direct, viaProxy: false, reason: null };

  const wanted = policy.route === 'auto' ? account.route : policy.route;
  if (wanted !== 'proxy') return { baseURL: direct, viaProxy: false, reason: null };

  if (!policy.backendReady) {
    return {
      baseURL: direct,
      viaProxy: false,
      reason: 'Бэкенд недоступен — запрос пойдёт напрямую из браузера',
    };
  }

  return { baseURL: proxyUrl(policy.backendUrl, direct), viaProxy: true, reason: null };
}

export const routeLabel = (endpoint: Endpoint): string =>
  endpoint.viaProxy ? 'через сервер' : 'напрямую';

export async function createLanguageModel(
  account: ProviderAccount,
  modelId: string,
  policy: EndpointPolicy = directPolicy(),
): Promise<LanguageModel> {
  const factory = await loadAdapter(account.protocol);
  const endpoint = endpointFor(account, policy);

  return factory(modelId, {
    apiKey: account.apiKey,
    baseURL: endpoint.baseURL,
    headers: account.headers,
    name: account.label,
  });
}
