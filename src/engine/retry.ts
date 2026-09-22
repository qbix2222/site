export type ErrorKind =
  | 'auth'
  | 'rate-limit'
  | 'overloaded'
  | 'context-overflow'
  | 'invalid-request'
  | 'network'
  | 'aborted'
  | 'server'
  | 'unknown';

export type Remedy = 'retry' | 'trim-context' | 'switch-model' | 'stop';

export interface ErrorDiagnosis {
  kind: ErrorKind;
  remedy: Remedy;
  retryable: boolean;
  retryAfterMs: number | null;
  message: string;
  status: number | null;
}

const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504, 520, 529]);
const FATAL_STATUS = new Set([400, 401, 402, 403, 404, 405, 413, 422]);

const CONTEXT_HINTS = [
  'context_length_exceeded',
  'context length',
  'maximum context',
  'too many tokens',
  'prompt is too long',
  'exceeds the model',
  'reduce the length',
  'input is too long',
];

const OVERLOAD_HINTS = ['overloaded', 'capacity', 'temporarily unavailable', 'try again later'];
const RATE_HINTS = ['rate limit', 'rate_limit', 'too many requests', 'quota', 'insufficient_quota'];
const AUTH_HINTS = [
  'invalid api key',
  'invalid_api_key',
  'incorrect api key',
  'api key not valid',
  'api key not',
  'invalid x-api-key',
  'unauthorized',
  'authentication',
  'permission denied',
  'billing_hard_limit_reached',
  'account is not active',
];
const ABORT_HINTS = ['aborted', 'abort', 'cancelled', 'canceled'];

export function statusOf(error: unknown): number | null {
  const candidates = [
    (error as { status?: unknown })?.status,
    (error as { statusCode?: unknown })?.statusCode,
    (error as { response?: { status?: unknown } })?.response?.status,
    (error as { error?: { status?: unknown } })?.error?.status,
  ];
  for (const value of candidates) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return null;
}

export function textOf(error: unknown): string {
  if (!error) return '';
  if (typeof error === 'string') return error;
  if (error instanceof Error) {
    const nested = (error as { error?: { message?: unknown } }).error?.message;
    return typeof nested === 'string' ? `${error.message} ${nested}` : error.message;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function containsAny(haystack: string, needles: string[]): boolean {
  return needles.some((needle) => haystack.includes(needle));
}

export function parseRetryAfter(source: unknown): number | null {
  if (!source) return null;
  const raw = typeof source === 'string' ? source : String(source);
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(Math.round(seconds * 1000), 120_000);
  }
  const date = Date.parse(raw);
  if (!Number.isNaN(date)) {
    return Math.min(Math.max(date - Date.now(), 0), 120_000);
  }
  return null;
}

export function diagnose(error: unknown, retryAfterHeader?: string | null): ErrorDiagnosis {
  const message = textOf(error);
  const haystack = message.toLowerCase();
  const status = statusOf(error);

  if (containsAny(haystack, ABORT_HINTS) && (status === null || status === 0)) {
    return {
      kind: 'aborted',
      remedy: 'stop',
      retryable: false,
      retryAfterMs: null,
      message: 'Остановлено',
      status,
    };
  }

  if (containsAny(haystack, CONTEXT_HINTS)) {
    return {
      kind: 'context-overflow',
      remedy: 'trim-context',
      retryable: true,
      retryAfterMs: 0,
      message: 'Запрос не помещается в контекстное окно модели',
      status,
    };
  }

  if (status === 429 || containsAny(haystack, RATE_HINTS)) {
    return {
      kind: 'rate-limit',
      remedy: 'retry',
      retryable: true,
      retryAfterMs: parseRetryAfter(retryAfterHeader),
      message: 'Провайдер ограничил частоту запросов',
      status,
    };
  }

  if (status === 401 || status === 403 || containsAny(haystack, AUTH_HINTS)) {
    return {
      kind: 'auth',
      remedy: 'stop',
      retryable: false,
      retryAfterMs: null,
      message: 'Ключ отклонён провайдером',
      status,
    };
  }

  if (containsAny(haystack, OVERLOAD_HINTS) || status === 503 || status === 529) {
    return {
      kind: 'overloaded',
      remedy: 'retry',
      retryable: true,
      retryAfterMs: parseRetryAfter(retryAfterHeader),
      message: 'Провайдер перегружен',
      status,
    };
  }

  if (status !== null && FATAL_STATUS.has(status)) {
    return {
      kind: 'invalid-request',
      remedy: 'stop',
      retryable: false,
      retryAfterMs: null,
      message: message.slice(0, 240) || 'Запрос отклонён',
      status,
    };
  }

  if (status !== null && RETRYABLE_STATUS.has(status)) {
    return {
      kind: 'server',
      remedy: 'retry',
      retryable: true,
      retryAfterMs: parseRetryAfter(retryAfterHeader),
      message: `Сбой провайдера (${status})`,
      status,
    };
  }

  if (error instanceof TypeError || containsAny(haystack, ['failed to fetch', 'networkerror', 'load failed'])) {
    return {
      kind: 'network',
      remedy: 'retry',
      retryable: true,
      retryAfterMs: null,
      message: 'Нет соединения с провайдером',
      status: null,
    };
  }

  return {
    kind: 'unknown',
    remedy: 'switch-model',
    retryable: false,
    retryAfterMs: null,
    message: message.slice(0, 240) || 'Неизвестная ошибка',
    status,
  };
}

export interface BackoffOptions {
  baseMs: number;
  factor?: number;
  maxMs?: number;
  attempt: number;
  jitter?: number;
  random?: () => number;
}

export function backoffDelay({
  baseMs,
  factor = 2,
  maxMs = 20_000,
  attempt,
  jitter = 0.25,
  random = Math.random,
}: BackoffOptions): number {
  const safeAttempt = Math.max(0, attempt);
  const exponential = Math.min(baseMs * factor ** safeAttempt, maxMs);
  const spread = exponential * jitter;
  const value = exponential - spread + random() * spread * 2;
  return Math.round(Math.min(Math.max(value, 0), maxMs));
}

export const delay = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
