import type { ModelRecord, ProviderAccount } from '../core/types';
import {
  BASE_CAPABILITIES,
  ZERO_COST,
  ZERO_LIMITS,
  applyPatch,
  confidenceOf,
  type CapabilityPatch,
} from '../core/capabilities';
import {
  ANTHROPIC_VERSION,
  directPolicy,
  endpointFor,
  type EndpointPolicy,
} from '../core/providers';
import { modelKey, providerScope, type RawCatalog, buildCatalogRecords } from './models-dev';

export type ProbeOutcome = 'ok' | 'denied' | 'http-error' | 'unreachable' | 'aborted';

export interface ProbeResult {
  outcome: ProbeOutcome;
  status: number | null;
  message: string | null;
  durationMs: number;
}

export interface DiscoveredModel {
  id: string;
  name: string | null;
  patch: CapabilityPatch;
  deprecated: boolean;
}

interface OpenAIModelEntry {
  id?: string;
  owned_by?: string;
  created?: number;
  context_length?: number;
  max_context_length?: number;
  architecture?: { input_modalities?: string[]; output_modalities?: string[] };
  supported_parameters?: string[];
  pricing?: { prompt?: string; completion?: string; request?: string };
  top_provider?: { context_length?: number; max_completion_tokens?: number };
}

interface AnthropicModelEntry {
  id?: string;
  display_name?: string;
  created_at?: string;
  max_input_tokens?: number;
  max_tokens?: number;
}

interface GoogleModelEntry {
  name?: string;
  displayName?: string;
  description?: string;
  inputTokenLimit?: number;
  outputTokenLimit?: number;
  supportedGenerationMethods?: string[];
}

const PER_TOKEN = 1_000_000;

const numeric = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return undefined;
};

export function requestInitFor(account: ProviderAccount, method: string): RequestInit {
  const headers = new Headers({ accept: 'application/json', ...account.headers });

  if (account.presetId === 'anthropic' && !headers.has('anthropic-version')) {
    headers.set('anthropic-version', ANTHROPIC_VERSION);
  }

  const init: RequestInit = { method, headers, cache: 'no-store' };

  if (account.apiKey) {
    if (account.discovery.kind === 'google-models') {
      headers.set('x-goog-api-key', account.apiKey);
    } else if (headers.has('x-api-key') || account.presetId === 'anthropic') {
      headers.set('x-api-key', account.apiKey);
    } else {
      headers.set('authorization', `Bearer ${account.apiKey}`);
    }
  }

  return init;
}

export function discoveryUrl(
  account: ProviderAccount,
  policy: EndpointPolicy = directPolicy(),
): string | null {
  const { kind, path } = account.discovery;
  if (kind === 'none' || !path) return null;

  const base = endpointFor(account, policy).baseURL;
  if (!base) return null;

  if (kind === 'google-models') {
    const separator = base.includes('?') ? '&' : '?';
    const suffix = account.apiKey ? `${separator}key=${encodeURIComponent(account.apiKey)}` : '';
    return `${base}${path}${suffix}`;
  }

  return `${base}${path}`;
}

export function classifyFailure(error: unknown): { outcome: ProbeOutcome; message: string } {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return { outcome: 'aborted', message: 'Запрос прерван' };
  }
  if (error instanceof TypeError) {
    return {
      outcome: 'unreachable',
      message: 'Сеть недоступна или провайдер не пропустил запрос из браузера',
    };
  }
  return {
    outcome: 'unreachable',
    message: error instanceof Error ? error.message : 'Неизвестная ошибка соединения',
  };
}

export function describeStatus(status: number): string | null {
  if (status === 401) return 'Ключ отклонён: проверьте, что скопировали его целиком';
  if (status === 403) return 'Доступ запрещён: ключу не хватает прав или регион заблокирован';
  if (status === 404) return 'Эндпоинт не найден: проверьте базовый URL провайдера';
  if (status === 429) return 'Провайдер ограничил частоту запросов';
  if (status >= 500) return `Сбой на стороне провайдера (${status})`;
  return `Неожиданный ответ ${status}`;
}

export async function probeAccount(
  account: ProviderAccount,
  source: typeof fetch = fetch,
  timeoutMs = 12000,
  policy: EndpointPolicy = directPolicy(),
): Promise<ProbeResult> {
  const url = discoveryUrl(account, policy);
  const started = performance.now();

  if (!url) {
    return {
      outcome: 'unreachable',
      status: null,
      message: 'У провайдера нет списка моделей — соединение проверяется первым запросом',
      durationMs: 0,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await source(url, { ...requestInitFor(account, 'GET'), signal: controller.signal });
    const durationMs = Math.round(performance.now() - started);

    if (response.ok) {
      return { outcome: 'ok', status: response.status, message: null, durationMs };
    }
    if (response.status === 401 || response.status === 403) {
      return {
        outcome: 'denied',
        status: response.status,
        message: describeStatus(response.status),
        durationMs,
      };
    }
    return {
      outcome: 'http-error',
      status: response.status,
      message: describeStatus(response.status),
      durationMs,
    };
  } catch (error) {
    const { outcome, message } = classifyFailure(error);
    return {
      outcome,
      status: null,
      message,
      durationMs: Math.round(performance.now() - started),
    };
  } finally {
    clearTimeout(timer);
  }
}

function parseOpenAIList(payload: unknown): DiscoveredModel[] {
  const entries = Array.isArray((payload as { data?: unknown }).data)
    ? ((payload as { data: OpenAIModelEntry[] }).data)
    : [];

  return entries.flatMap((entry) => {
    const id = entry.id?.trim();
    if (!id) return [];

    const supported = entry.supported_parameters ?? [];
    const context =
      numeric(entry.context_length) ??
      numeric(entry.max_context_length) ??
      numeric(entry.top_provider?.context_length);
    const output = numeric(entry.top_provider?.max_completion_tokens);
    const promptPrice = numeric(entry.pricing?.prompt);
    const completionPrice = numeric(entry.pricing?.completion);

    const patch: CapabilityPatch = {
      context,
      output,
      inputModalities: entry.architecture?.input_modalities,
      outputModalities: entry.architecture?.output_modalities,
      costInput: promptPrice !== undefined ? promptPrice * PER_TOKEN : undefined,
      costOutput: completionPrice !== undefined ? completionPrice * PER_TOKEN : undefined,
    };

    if (supported.length) {
      patch.toolCall = supported.includes('tools');
      patch.reasoning = supported.includes('reasoning');
      patch.structuredOutput = supported.includes('structured_outputs') || supported.includes('response_format');
      patch.temperature = supported.includes('temperature');
    }

    return [{ id, name: null, patch, deprecated: false }];
  });
}

function parseAnthropicList(payload: unknown): DiscoveredModel[] {
  const entries = Array.isArray((payload as { data?: unknown }).data)
    ? ((payload as { data: AnthropicModelEntry[] }).data)
    : [];

  return entries.flatMap((entry) => {
    const id = entry.id?.trim();
    if (!id) return [];

    return [
      {
        id,
        name: entry.display_name?.trim() || null,
        patch: {
          context: numeric(entry.max_input_tokens),
          output: numeric(entry.max_tokens),
        },
        deprecated: false,
      },
    ];
  });
}

function parseGoogleList(payload: unknown): DiscoveredModel[] {
  const entries = Array.isArray((payload as { models?: unknown }).models)
    ? ((payload as { models: GoogleModelEntry[] }).models)
    : [];

  return entries.flatMap((entry) => {
    const rawName = entry.name?.trim();
    if (!rawName) return [];

    const id = rawName.replace(/^models\//, '');
    const multimodal = /gemini/.test(id);

    return [
      {
        id,
        name: entry.displayName?.trim() || null,
        patch: {
          context: numeric(entry.inputTokenLimit),
          output: numeric(entry.outputTokenLimit),
          attachment: multimodal ? true : undefined,
          inputModalities: multimodal ? ['text', 'image', 'audio', 'video', 'pdf'] : undefined,
          toolCall: multimodal ? true : undefined,
        },
        deprecated: false,
      },
    ];
  });
}

export function parseDiscoveryPayload(
  account: ProviderAccount,
  payload: unknown,
): DiscoveredModel[] {
  switch (account.discovery.kind) {
    case 'openai-models':
      return parseOpenAIList(payload);
    case 'anthropic-models':
      return parseAnthropicList(payload);
    case 'google-models':
      return parseGoogleList(payload);
    case 'none':
      return [];
  }
}

export async function discoverModels(
  account: ProviderAccount,
  source: typeof fetch = fetch,
  timeoutMs = 20000,
  policy: EndpointPolicy = directPolicy(),
): Promise<DiscoveredModel[]> {
  const url = discoveryUrl(account, policy);
  if (!url) return [];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await source(url, {
      ...requestInitFor(account, 'GET'),
      signal: controller.signal,
    });
    if (!response.ok) return [];
    return parseDiscoveryPayload(account, await response.json());
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export function mergeModelRecords(
  account: ProviderAccount,
  catalogRecords: ModelRecord[],
  discovered: DiscoveredModel[],
): ModelRecord[] {
  const scope = providerScope(account);
  const byId = new Map(catalogRecords.map((record) => [record.id, record]));
  const merged = new Map(byId);

  for (const model of discovered) {
    const existing = byId.get(model.id);

    if (existing) {
      const patched = applyPatch(
        existing.capabilities,
        existing.limits,
        existing.cost,
        model.patch,
      );
      merged.set(model.id, {
        ...existing,
        name: model.name ?? existing.name,
        capabilities: patched.capabilities,
        limits: patched.limits,
        cost: patched.cost,
        deprecated: existing.deprecated || model.deprecated,
      });
      continue;
    }

    const patched = applyPatch(BASE_CAPABILITIES, ZERO_LIMITS, ZERO_COST, model.patch);
    merged.set(model.id, {
      key: modelKey(scope, model.id),
      providerId: account.id,
      id: model.id,
      name: model.name ?? model.id,
      family: null,
      capabilities: patched.capabilities,
      limits: patched.limits,
      cost: patched.cost,
      knowledge: null,
      releasedAt: null,
      free: patched.cost.input === 0 && patched.cost.output === 0,
      source: 'provider',
      confidence: confidenceOf('provider'),
      deprecated: model.deprecated,
      description: null,
    });
  }

  return [...merged.values()].sort(compareModels);
}

const FAMILY_WEIGHT: Array<[RegExp, number]> = [
  [/opus|pro|ultra/i, 0],
  [/sonnet|flash(?!-lite)|gpt-5(?!-mini|\.1-mini)|grok-4/i, 1],
  [/haiku|mini|lite|nano|small|instant/i, 2],
];

function familyWeight(record: ModelRecord): number {
  const index = FAMILY_WEIGHT.findIndex(([pattern]) => pattern.test(record.id));
  return index < 0 ? 3 : index;
}

export function compareModels(left: ModelRecord, right: ModelRecord): number {
  const leftFree = left.cost.input === 0 && left.cost.output === 0 ? 0 : 1;
  const rightFree = right.cost.input === 0 && right.cost.output === 0 ? 0 : 1;
  if (leftFree !== rightFree) return leftFree - rightFree;

  const weight = familyWeight(left) - familyWeight(right);
  if (weight !== 0) return weight;

  return left.name.localeCompare(right.name, 'ru');
}

export async function buildAccountModels(
  account: ProviderAccount,
  catalog: RawCatalog | null,
  source: typeof fetch = fetch,
  policy: EndpointPolicy = directPolicy(),
): Promise<ModelRecord[]> {
  const catalogRecords = catalog ? buildCatalogRecords(catalog, account) : [];
  const discovered = await discoverModels(account, source, 20000, policy);
  return mergeModelRecords(account, catalogRecords, discovered);
}
