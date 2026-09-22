import type { ErrorDiagnosis } from './retry';

export type RecoveryAction =
  | { kind: 'retry'; waitMs: number; trim: boolean; note: string }
  | { kind: 'give-up'; note: string };

export interface RecoveryContext {
  diagnosis: ErrorDiagnosis;
  attempt: number;
  maxRetries: number;
  retryBaseMs: number;
  canTrim: boolean;
  trimmedAlready: number;
  waitMs: number;
}

const TRIM_LIMIT = 3;

export function planRecovery(context: RecoveryContext): RecoveryAction {
  const { diagnosis, attempt, maxRetries, canTrim, trimmedAlready, waitMs } = context;

  if (diagnosis.kind === 'aborted') {
    return { kind: 'give-up', note: 'Остановлено вручную' };
  }

  if (diagnosis.kind === 'auth') {
    return { kind: 'give-up', note: diagnosis.message };
  }

  const wantsTrim = diagnosis.remedy === 'trim-context';
  const trimAvailable = wantsTrim && canTrim && trimmedAlready < TRIM_LIMIT;
  const retryAvailable = diagnosis.retryable && attempt <= maxRetries;

  if (!trimAvailable && !retryAvailable) {
    return { kind: 'give-up', note: diagnosis.message };
  }

  return {
    kind: 'retry',
    waitMs: trimAvailable ? 0 : waitMs,
    trim: trimAvailable,
    note: trimAvailable
      ? `Контекст не влез: урезаю историю (попытка ${trimmedAlready + 1} из ${TRIM_LIMIT})`
      : diagnosis.message,
  };
}

export function describeAttempt(attempt: number, maxRetries: number): string {
  if (attempt <= 1) return 'первая попытка';
  return `попытка ${attempt} из ${maxRetries + 1}`;
}
