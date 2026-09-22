import type { ModelRecord } from './types';
import { acceptsAudio, acceptsImages, acceptsModality } from './capabilities';

export interface RouteRequest {
  requestedKey: string;
  hasImages: boolean;
  hasDocuments: boolean;
  hasAudio: boolean;
  needsTools: boolean;
  needsReasoning: boolean;
  estimatedTokens: number;
}

export interface RouteFailure {
  ok: false;
  reason: string;
  requested: ModelRecord | null;
  demanded: RouteRequest;
}

export type RouteOutcome =
  | { ok: true; model: ModelRecord; redirected: boolean; notice: string | null }
  | RouteFailure;

const supportsRequest = (model: ModelRecord, request: RouteRequest): boolean => {
  if (request.hasImages && !acceptsImages(model.capabilities)) return false;
  if (request.hasDocuments && !acceptsModality(model.capabilities, 'pdf')) return false;
  if (request.hasAudio && !acceptsAudio(model.capabilities)) return false;
  if (request.needsTools && !model.capabilities.toolCall) return false;
  if (request.needsReasoning && !model.capabilities.reasoning) return false;
  if (model.limits.context > 0 && request.estimatedTokens > model.limits.context) return false;
  return true;
};

const demandLabel = (request: RouteRequest): string => {
  const parts: string[] = [];
  if (request.hasImages) parts.push('изображения');
  if (request.hasDocuments) parts.push('документы');
  if (request.hasAudio) parts.push('аудио');
  if (request.needsTools) parts.push('инструменты');
  if (request.needsReasoning) parts.push('рассуждения');
  return parts.join(', ');
};

function rankCandidate(model: ModelRecord, request: RouteRequest): number {
  const known = model.confidence;
  const fits = model.limits.context > 0 && model.limits.context >= request.estimatedTokens ? 1 : 0;
  const affordable = model.cost.input + model.cost.output > 0 ? 0 : 0.15;
  const tools = model.capabilities.toolCall ? 0.2 : 0;
  const reasoning = model.capabilities.reasoning ? 0.1 : 0;
  const fresh = model.deprecated ? -0.5 : 0;
  return known + fits + affordable + tools + reasoning + fresh;
}

export function pickCapableModel(
  pool: ModelRecord[],
  request: RouteRequest,
): ModelRecord | null {
  const capable = pool.filter((model) => !model.deprecated && supportsRequest(model, request));
  if (!capable.length) return null;

  return capable.reduce((best, candidate) =>
    rankCandidate(candidate, request) > rankCandidate(best, request) ? candidate : best,
  );
}

export function resolveRoute(
  pool: ModelRecord[],
  request: RouteRequest,
  allowRedirect: boolean,
): RouteOutcome {
  const requested = pool.find((model) => model.key === request.requestedKey) ?? null;

  if (requested && supportsRequest(requested, request)) {
    return { ok: true, model: requested, redirected: false, notice: null };
  }

  if (!requested) {
    return {
      ok: false,
      reason: 'Модель не найдена среди подключённых провайдеров',
      requested: null,
      demanded: request,
    };
  }

  if (!allowRedirect) {
    return {
      ok: false,
      reason: `${requested.name} не поддерживает: ${demandLabel(request)}`,
      requested,
      demanded: request,
    };
  }

  const fallback = pickCapableModel(
    pool.filter((model) => model.key !== requested.key),
    request,
  );

  if (!fallback) {
    return {
      ok: false,
      reason: `Ни одна подключённая модель не поддерживает: ${demandLabel(request)}`,
      requested,
      demanded: request,
    };
  }

  return {
    ok: true,
    model: fallback,
    redirected: true,
    notice: `${requested.name} не принимает ${demandLabel(request)} — запрос отправлен в ${fallback.name}`,
  };
}

export const sameProviderPool = (pool: ModelRecord[], model: ModelRecord): ModelRecord[] =>
  pool.filter((candidate) => candidate.providerId === model.providerId);
