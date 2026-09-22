import type { Modality, ModelRecord, ProviderAccount } from '../core/types';
import {
  BASE_CAPABILITIES,
  ZERO_COST,
  ZERO_LIMITS,
  applyPatch,
  confidenceOf,
  type CapabilityPatch,
} from '../core/capabilities';

export const CATALOG_URL = 'https://models.dev/api.json';
export const CATALOG_TTL_MS = 6 * 60 * 60 * 1000;

interface RawModelEntry {
  name?: string;
  family?: string;
  attachment?: boolean;
  reasoning?: boolean;
  tool_call?: boolean;
  structured_output?: boolean;
  temperature?: boolean;
  knowledge?: string;
  release_date?: string;
  last_updated?: string;
  open_weights?: boolean;
  description?: string;
  status?: string;
  cost?: {
    input?: number;
    output?: number;
    cache_read?: number;
    cache_write?: number;
    reasoning?: number;
  };
  limit?: { context?: number; input?: number; output?: number };
  modalities?: { input?: string[]; output?: string[] };
  options?: Record<string, unknown>;
}

interface RawProviderEntry {
  name?: string;
  doc?: string;
  models?: Record<string, RawModelEntry>;
}

export type RawCatalog = Record<string, RawProviderEntry>;

const MODALITIES: Modality[] = ['text', 'image', 'audio', 'video', 'pdf', 'file'];

const toModalities = (values: string[] | undefined): Modality[] | undefined => {
  if (!values?.length) return undefined;
  const known = values.filter((value): value is Modality =>
    MODALITIES.includes(value as Modality),
  );
  return known.length ? known : undefined;
};

export function patchFromCatalogEntry(entry: RawModelEntry): CapabilityPatch {
  return {
    attachment: entry.attachment,
    reasoning: entry.reasoning,
    toolCall: entry.tool_call,
    structuredOutput: entry.structured_output,
    temperature: entry.temperature,
    inputModalities: toModalities(entry.modalities?.input),
    outputModalities: toModalities(entry.modalities?.output),
    context: entry.limit?.context,
    input: entry.limit?.input,
    output: entry.limit?.output,
    costInput: entry.cost?.input,
    costOutput: entry.cost?.output,
    costCacheRead: entry.cost?.cache_read,
    costCacheWrite: entry.cost?.cache_write,
    costReasoning: entry.cost?.reasoning,
  };
}

export const providerScope = (account: ProviderAccount): string =>
  account.presetId === 'custom'
    ? `custom:${new URL(account.baseUrl).host}`
    : account.presetId;

export const modelKey = (scope: string, modelId: string): string => `${scope}/${modelId}`;

export const splitModelKey = (key: string): { scope: string; id: string } => {
  if (key.startsWith('custom:')) {
    const withoutPrefix = key.slice('custom:'.length);
    const slash = withoutPrefix.indexOf('/');
    if (slash > -1) {
      return { scope: `custom:${withoutPrefix.slice(0, slash)}`, id: withoutPrefix.slice(slash + 1) };
    }
    return { scope: 'custom', id: withoutPrefix };
  }
  const slash = key.indexOf('/');
  if (slash < 0) return { scope: '', id: key };
  return { scope: key.slice(0, slash), id: key.slice(slash + 1) };
};

export function buildCatalogRecords(
  catalog: RawCatalog,
  account: ProviderAccount,
): ModelRecord[] {
  const catalogId = account.catalogId;
  if (!catalogId) return [];

  const provider = catalog[catalogId];
  if (!provider?.models) return [];

  const scope = providerScope(account);
  const records: ModelRecord[] = [];

  for (const [id, entry] of Object.entries(provider.models)) {
    const merged = applyPatch(
      BASE_CAPABILITIES,
      ZERO_LIMITS,
      ZERO_COST,
      patchFromCatalogEntry(entry),
    );

    records.push({
      key: modelKey(scope, id),
      providerId: account.id,
      id,
      name: entry.name?.trim() || id,
      family: entry.family ?? null,
      capabilities: merged.capabilities,
      limits: merged.limits,
      cost: merged.cost,
      knowledge: entry.knowledge ?? null,
      releasedAt: entry.release_date ?? null,
      free: merged.cost.input === 0 && merged.cost.output === 0,
      source: 'catalog',
      confidence: confidenceOf('catalog'),
      deprecated: entry.status === 'deprecated',
      description: entry.description?.trim() || null,
    });
  }

  return records;
}

export function catalogProviderIds(catalog: RawCatalog): string[] {
  return Object.keys(catalog).sort();
}

export async function fetchCatalog(
  source: typeof fetch = fetch,
  timeoutMs = 20000,
): Promise<RawCatalog> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await source(CATALOG_URL, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });
    if (!response.ok) {
      throw new Error(`Каталог моделей ответил ${response.status}`);
    }
    return (await response.json()) as RawCatalog;
  } finally {
    clearTimeout(timer);
  }
}
