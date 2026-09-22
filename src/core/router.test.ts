import { describe, expect, it } from 'vitest';
import type { ModelRecord } from './types';
import { BASE_CAPABILITIES, ZERO_COST, ZERO_LIMITS } from './capabilities';
import { pickCapableModel, resolveRoute, type RouteRequest } from './router';

function model(partial: Partial<ModelRecord> & { key: string }): ModelRecord {
  return {
    providerId: 'acc-1',
    id: partial.key,
    name: partial.key,
    family: null,
    capabilities: BASE_CAPABILITIES,
    limits: { ...ZERO_LIMITS, context: 32_000 },
    cost: { ...ZERO_COST, input: 1, output: 3 },
    knowledge: null,
    releasedAt: null,
    free: false,
    source: 'catalog',
    confidence: 0.75,
    deprecated: false,
    description: null,
    ...partial,
  };
}

const textOnly = model({ key: 'provider/text-only', name: 'Text Only' });

const vision = model({
  key: 'provider/vision',
  name: 'Vision',
  capabilities: {
    ...BASE_CAPABILITIES,
    attachment: true,
    inputModalities: ['text', 'image'],
  },
});

const toolModel = model({
  key: 'provider/tools',
  name: 'Tools',
  capabilities: { ...BASE_CAPABILITIES, toolCall: true },
});

const pool = [textOnly, vision, toolModel];

const baseRequest: RouteRequest = {
  requestedKey: textOnly.key,
  hasImages: false,
  hasDocuments: false,
  hasAudio: false,
  needsTools: false,
  needsReasoning: false,
  estimatedTokens: 500,
};

describe('resolveRoute', () => {
  it('оставляет запрошенную модель, если она подходит', () => {
    const outcome = resolveRoute(pool, baseRequest, true);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.model.key).toBe(textOnly.key);
    expect(outcome.redirected).toBe(false);
  });

  it('уводит запрос с изображением на модель со зрением', () => {
    const outcome = resolveRoute(pool, { ...baseRequest, hasImages: true }, true);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.model.key).toBe(vision.key);
    expect(outcome.redirected).toBe(true);
    expect(outcome.notice).toContain('Vision');
  });

  it('требует инструментальную модель, когда включены инструменты', () => {
    const outcome = resolveRoute(pool, { ...baseRequest, needsTools: true }, true);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.model.capabilities.toolCall).toBe(true);
  });

  it('отказывается отправлять изображение в текстовую модель без автоподбора', () => {
    const outcome = resolveRoute(pool, { ...baseRequest, hasImages: true }, false);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toContain('изображения');
    expect(outcome.requested?.key).toBe(textOnly.key);
  });

  it('сообщает, когда ни одна модель не подходит', () => {
    const outcome = resolveRoute(pool, { ...baseRequest, hasAudio: true }, true);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toContain('Ни одна подключённая модель');
  });

  it('не теряет запрос из-за неизвестной модели', () => {
    const outcome = resolveRoute(pool, { ...baseRequest, requestedKey: 'ghost/none' }, true);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toContain('не найдена');
  });

  it('учитывает переполнение контекстного окна', () => {
    const small = model({ key: 'provider/small', limits: { ...ZERO_LIMITS, context: 1000 } });
    const outcome = resolveRoute(
      [small, vision],
      { ...baseRequest, requestedKey: small.key, estimatedTokens: 4000 },
      true,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.model.key).toBe(vision.key);
  });
});

describe('pickCapableModel', () => {
  it('предпочитает модель с известными возможностями', () => {
    const guess = model({
      key: 'provider/guess',
      source: 'unknown',
      confidence: 0.2,
      capabilities: {
        ...BASE_CAPABILITIES,
        attachment: true,
        inputModalities: ['text', 'image'],
      },
    });
    const chosen = pickCapableModel([guess, vision], { ...baseRequest, hasImages: true });
    expect(chosen?.key).toBe(vision.key);
  });

  it('игнорирует снятые с публикации модели', () => {
    const retired = model({
      key: 'provider/retired',
      deprecated: true,
      capabilities: {
        ...BASE_CAPABILITIES,
        attachment: true,
        inputModalities: ['text', 'image'],
      },
    });
    expect(pickCapableModel([retired], { ...baseRequest, hasImages: true })).toBeNull();
  });

  it('не выбирает ничего из пустого пула', () => {
    expect(pickCapableModel([], baseRequest)).toBeNull();
  });
});
