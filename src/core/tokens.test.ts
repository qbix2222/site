import { describe, expect, it } from 'vitest';
import type { UIMessage } from 'ai';
import {
  budgetFor,
  estimateImageTokens,
  estimateTextTokens,
  estimateUsageCost,
  fitContext,
  type FitBudget,
} from './tokens';
import { ZERO_COST } from './capabilities';

function textMessage(role: UIMessage['role'], text: string): UIMessage {
  return { id: `${role}-${text.length}-${Math.random()}`, role, parts: [{ type: 'text', text }] };
}

const budget: FitBudget = {
  contextWindow: 8000,
  ratio: 0.9,
  instructionsTokens: 200,
  toolsTokens: 240,
  reserveOutput: 1024,
};

describe('estimateTextTokens', () => {
  it('считает токены пропорционально объёму текста', () => {
    expect(estimateTextTokens('')).toBe(0);
    expect(estimateTextTokens('abcd')).toBe(2);
    expect(estimateTextTokens('a'.repeat(3600))).toBe(1000);
  });

  it('оценивает изображение по сетке тайлов', () => {
    expect(estimateImageTokens(512, 512)).toBe(255);
    expect(estimateImageTokens(1024, 1024)).toBe(765);
    expect(estimateImageTokens(0, 0)).toBe(1120);
  });

  it('уменьшает огромные изображения до расчётного размера', () => {
    const huge = estimateImageTokens(8000, 8000);
    const scaled = estimateImageTokens(2048, 2048);
    expect(huge).toBe(scaled);
  });
});

describe('budgetFor', () => {
  it('вычитает инструкции, инструменты и резерв на ответ', () => {
    expect(budgetFor(budget)).toBe(Math.floor(8000 * 0.9) - 200 - 240 - 1024);
  });

  it('не ограничивает разговор, когда окно неизвестно', () => {
    expect(budgetFor({ ...budget, contextWindow: 0 })).toBe(Number.POSITIVE_INFINITY);
  });

  it('не уходит в отрицательный бюджет', () => {
    expect(budgetFor({ ...budget, contextWindow: 500, ratio: 0.5 })).toBe(0);
  });
});

describe('fitContext', () => {
  it('сохраняет всю историю, если она помещается', () => {
    const messages = [textMessage('user', 'привет'), textMessage('assistant', 'здравствуй')];
    const plan = fitContext(messages, budget);
    expect(plan.start).toBe(0);
    expect(plan.dropped).toBe(0);
    expect(plan.overflow).toBe(false);
  });

  it('отбрасывает старое и начинает границей с сообщения пользователя', () => {
    const messages = Array.from({ length: 14 }, (_, index) =>
      textMessage(index % 2 === 0 ? 'user' : 'assistant', 'а'.repeat(900)),
    );
    messages.push(textMessage('user', 'новый вопрос'));

    const plan = fitContext(messages, { ...budget, contextWindow: 4000 });
    expect(plan.dropped).toBeGreaterThan(0);
    expect(messages[plan.start].role).toBe('user');
    expect(plan.estimated).toBeLessThanOrEqual(plan.budget);
    expect(plan.overflow).toBe(false);
    expect(plan.start).toBeLessThan(messages.length - 1);
  });

  it('не выбрасывает последний вопрос, даже если он один не помещается', () => {
    const messages = [
      textMessage('assistant', 'b'.repeat(20000)),
      textMessage('user', 'c'.repeat(20000)),
    ];
    const plan = fitContext(messages, { ...budget, contextWindow: 2000, reserveOutput: 0 });
    expect(plan.start).toBe(1);
    expect(plan.overflow).toBe(true);
  });

  it('не начинает историю с ответа модели', () => {
    const messages = [
      textMessage('user', 'a'.repeat(6000)),
      textMessage('assistant', 'b'.repeat(600)),
      textMessage('user', 'c'.repeat(120)),
      textMessage('assistant', 'd'.repeat(120)),
    ];
    const plan = fitContext(messages, {
      contextWindow: 500,
      ratio: 0.8,
      instructionsTokens: 100,
      toolsTokens: 100,
      reserveOutput: 100,
    });
    expect(plan.dropped).toBe(2);
    expect(messages[plan.start].role).toBe('user');
  });

  it('сообщает о переполнении, когда не помещается даже последнее сообщение', () => {
    const messages = [textMessage('user', 'a'.repeat(200000))];
    const plan = fitContext(messages, { ...budget, contextWindow: 1000 });
    expect(plan.overflow).toBe(true);
    expect(plan.start).toBe(0);
    expect(plan.estimated).toBeGreaterThan(plan.budget);
  });

  it('работает с пустой историей', () => {
    const plan = fitContext([], budget);
    expect(plan.start).toBe(0);
    expect(plan.estimated).toBe(0);
  });
});

describe('estimateUsageCost', () => {
  it('считает стоимость по тарифам за миллион токенов', () => {
    const cost = estimateUsageCost(
      {
        inputTokens: 1000,
        outputTokens: 500,
        reasoningTokens: 0,
        cachedInputTokens: 0,
        costUsd: 0,
        durationMs: 0,
      },
      { ...ZERO_COST, input: 3, output: 15 },
    );
    expect(cost).toBeCloseTo(0.003 + 0.0075, 10);
  });

  it('учитывает кеш прочитанных токенов', () => {
    const cost = estimateUsageCost(
      {
        inputTokens: 1000,
        outputTokens: 0,
        reasoningTokens: 0,
        cachedInputTokens: 1000,
        costUsd: 0,
        durationMs: 0,
      },
      { ...ZERO_COST, input: 3, cacheRead: 0.3 },
    );
    expect(cost).toBeCloseTo(0.0003, 10);
  });
});
