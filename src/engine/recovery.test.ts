import { describe, expect, it } from 'vitest';
import { planRecovery, describeAttempt } from './recovery';
import { diagnose } from './retry';

const base = {
  attempt: 1,
  maxRetries: 2,
  retryBaseMs: 400,
  canTrim: true,
  trimmedAlready: 0,
  waitMs: 800,
};

describe('planRecovery', () => {
  it('повторяет сетевой сбой с ожиданием', () => {
    const action = planRecovery({ ...base, diagnosis: diagnose(new TypeError('Failed to fetch')) });

    expect(action.kind).toBe('retry');
    if (action.kind !== 'retry') return;
    expect(action.trim).toBe(false);
    expect(action.waitMs).toBe(800);
  });

  it('уважает Retry-After от провайдера', () => {
    const diagnosis = diagnose(new Error('Too Many Requests'), '7');
    const action = planRecovery({ ...base, diagnosis, waitMs: diagnosis.retryAfterMs ?? 0 });

    expect(diagnosis.kind).toBe('rate-limit');
    expect(action.kind).toBe('retry');
    if (action.kind !== 'retry') return;
    expect(action.waitMs).toBe(7_000);
  });

  it('режет контекст вместо ожидания', () => {
    const diagnosis = diagnose(
      new Error("This model's maximum context length is 8192 tokens"),
    );

    expect(diagnosis.remedy).toBe('trim-context');

    const action = planRecovery({ ...base, diagnosis });
    expect(action.kind).toBe('retry');
    if (action.kind !== 'retry') return;
    expect(action.trim).toBe(true);
    expect(action.waitMs).toBe(0);
    expect(action.note).toContain('урезаю историю');
  });

  it('останавливается, когда резать больше нечего', () => {
    const diagnosis = diagnose(new Error('prompt is too long'));
    const action = planRecovery({ ...base, diagnosis, canTrim: false });

    expect(action.kind).toBe('retry');
    if (action.kind !== 'retry') return;
    expect(action.trim).toBe(false);
  });

  it('не режет контекст бесконечно', () => {
    const diagnosis = diagnose(new Error('input is too long'));
    const action = planRecovery({ ...base, diagnosis, trimmedAlready: 3, maxRetries: 0 });

    expect(action.kind).toBe('give-up');
  });

  it('не спорит с ошибкой авторизации', () => {
    const diagnosis = diagnose(new Error('Incorrect API key provided'));
    const action = planRecovery({ ...base, diagnosis });

    expect(diagnosis.kind).toBe('auth');
    expect(action.kind).toBe('give-up');
    if (action.kind !== 'give-up') return;
    expect(action.note).toBe('Ключ отклонён провайдером');
  });

  it('сдаётся после исчерпания попыток', () => {
    const diagnosis = diagnose(new TypeError('network went away'));
    const action = planRecovery({ ...base, diagnosis, attempt: 3, maxRetries: 2 });

    expect(action.kind).toBe('give-up');
  });

  it('не трогает остановку пользователем', () => {
    const diagnosis = diagnose(new DOMException('Aborted', 'AbortError'));
    const action = planRecovery({ ...base, diagnosis });

    expect(diagnosis.kind).toBe('aborted');
    expect(action.kind).toBe('give-up');
    if (action.kind !== 'give-up') return;
    expect(action.note).toBe('Остановлено вручную');
  });

  it('повторяет перегрузку провайдера', () => {
    const diagnosis = diagnose(new Error('Anthropic’s API is temporarily overloaded'));
    const action = planRecovery({ ...base, diagnosis });

    expect(diagnosis.kind).toBe('overloaded');
    expect(action.kind).toBe('retry');
  });
});

describe('describeAttempt', () => {
  it('по-человечески описывает номер попытки', () => {
    expect(describeAttempt(1, 3)).toBe('первая попытка');
    expect(describeAttempt(2, 3)).toBe('попытка 2 из 4');
  });
});
