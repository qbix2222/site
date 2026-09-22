import { describe, expect, it } from 'vitest';
import {
  backoffDelay,
  diagnose,
  parseRetryAfter,
  statusOf,
  textOf,
} from './retry';

class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

describe('statusOf', () => {
  it('находит статус в разных формах ошибки', () => {
    expect(statusOf(new HttpError('boom', 429))).toBe(429);
    expect(statusOf({ response: { status: 503 } })).toBe(503);
    expect(statusOf({ error: { status: 401 } })).toBe(401);
    expect(statusOf(new Error('нет статуса'))).toBeNull();
  });
});

describe('textOf', () => {
  it('раскрывает вложенное сообщение провайдера', () => {
    const error = Object.assign(new Error('outer'), {
      error: { message: 'inner detail' },
    });
    expect(textOf(error)).toContain('outer');
    expect(textOf(error)).toContain('inner detail');
  });

  it('переживает циклические объекты', () => {
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic.self = cyclic;
    expect(() => textOf(cyclic)).not.toThrow();
  });
});

describe('parseRetryAfter', () => {
  it('читает секунды', () => {
    expect(parseRetryAfter('3')).toBe(3000);
    expect(parseRetryAfter('0')).toBe(0);
  });

  it('ограничивает потолок двумя минутами', () => {
    expect(parseRetryAfter('9999')).toBe(120_000);
  });

  it('читает HTTP-дату в будущем', () => {
    const future = new Date(Date.now() + 5000).toUTCString();
    const parsed = parseRetryAfter(future);
    expect(parsed).toBeGreaterThan(3000);
    expect(parsed).toBeLessThanOrEqual(6000);
  });

  it('возвращает ноль для пустого значения', () => {
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter(undefined)).toBeNull();
  });
});

describe('diagnose', () => {
  it('распознаёт переполнение контекста и предлагает урезание', () => {
    const diagnosis = diagnose(
      new HttpError("This model's maximum context length is 8192 tokens", 400),
    );
    expect(diagnosis.kind).toBe('context-overflow');
    expect(diagnosis.remedy).toBe('trim-context');
    expect(diagnosis.retryable).toBe(true);
  });

  it('распознаёт лимит частоты и берёт retry-after', () => {
    const diagnosis = diagnose(new HttpError('Rate limit reached', 429), '7');
    expect(diagnosis.kind).toBe('rate-limit');
    expect(diagnosis.retryable).toBe(true);
    expect(diagnosis.retryAfterMs).toBe(7000);
  });

  it('не повторяет запрос с отклонённым ключом', () => {
    expect(diagnose(new HttpError('Incorrect API key provided', 401)).remedy).toBe('stop');
    expect(diagnose(new HttpError('forbidden', 403)).retryable).toBe(false);
  });

  it('повторяет запрос при перегрузке провайдера', () => {
    const diagnosis = diagnose(new HttpError('Overloaded, please retry', 529));
    expect(diagnosis.kind).toBe('overloaded');
    expect(diagnosis.remedy).toBe('retry');
  });

  it('повторяет сетевой сбой', () => {
    const diagnosis = diagnose(new TypeError('Failed to fetch'));
    expect(diagnosis.kind).toBe('network');
    expect(diagnosis.retryable).toBe(true);
  });

  it('останавливается на отмене пользователем', () => {
    const diagnosis = diagnose(new DOMException('The user aborted a request.', 'AbortError'));
    expect(diagnosis.kind).toBe('aborted');
    expect(diagnosis.remedy).toBe('stop');
    expect(diagnosis.retryable).toBe(false);
  });

  it('повторяет серверную ошибку 502', () => {
    const diagnosis = diagnose(new HttpError('Bad Gateway', 502));
    expect(diagnosis.kind).toBe('server');
    expect(diagnosis.retryable).toBe(true);
  });

  it('предлагает смену модели для неразобранной ошибки', () => {
    const diagnosis = diagnose(new HttpError('модель вернула пустоту', 418));
    expect(diagnosis.remedy).toBe('switch-model');
    expect(diagnosis.message.length).toBeGreaterThan(0);
  });
});

describe('backoffDelay', () => {
  it('растёт экспоненциально', () => {
    const options = { baseMs: 400, maxMs: 20_000, jitter: 0, random: () => 0.5 };
    expect(backoffDelay({ ...options, attempt: 0 })).toBe(400);
    expect(backoffDelay({ ...options, attempt: 1 })).toBe(800);
    expect(backoffDelay({ ...options, attempt: 2 })).toBe(1600);
    expect(backoffDelay({ ...options, attempt: 3 })).toBe(3200);
  });

  it('не превышает потолок', () => {
    const value = backoffDelay({ baseMs: 1000, maxMs: 5000, attempt: 12, random: () => 1 });
    expect(value).toBeLessThanOrEqual(5000);
  });

  it('разбрасывает задержку в пределах джиттера', () => {
    const low = backoffDelay({ baseMs: 1000, attempt: 0, jitter: 0.25, random: () => 0 });
    const high = backoffDelay({ baseMs: 1000, attempt: 0, jitter: 0.25, random: () => 1 });
    expect(low).toBe(750);
    expect(high).toBe(1250);
  });

  it('не уходит в отрицательные значения', () => {
    const value = backoffDelay({ baseMs: 100, attempt: 0, jitter: 1, random: () => 0 });
    expect(value).toBeGreaterThanOrEqual(0);
  });
});
