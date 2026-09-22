import { githubRepos, hackerNews, wikipedia, type SearchHit, type SearchSource } from '../../server/search';
import type { ExtractedPage } from '../../server/extract';
import type { SearchProviderId } from '../core/types';
import { proxyUrl } from '../../server/target';

export interface BackendStatus {
  ready: boolean;
  checkedAt: number | null;
  origin: string;
  error: string | null;
  search: Record<string, boolean>;
}

export const unknownBackend = (): BackendStatus => ({
  ready: false,
  checkedAt: null,
  origin: '',
  error: null,
  search: {},
});

export const apiUrl = (backendUrl: string, path: string): string =>
  `${backendUrl.replace(/\/+$/, '')}${path}`;

export async function probeBackend(
  backendUrl: string,
  source: typeof fetch = fetch,
  timeoutMs = 6_000,
): Promise<BackendStatus> {
  const origin = backendUrl.replace(/\/+$/, '');

  try {
    const response = await source(apiUrl(origin, '/api/health'), {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      return {
        ready: false,
        checkedAt: Date.now(),
        origin,
        error: `Бэкенд ответил ${response.status}`,
        search: {},
      };
    }

    const payload = (await response.json()) as { ok?: boolean; search?: Record<string, boolean> };

    return {
      ready: payload.ok === true,
      checkedAt: Date.now(),
      origin,
      error: null,
      search: payload.search ?? {},
    };
  } catch {
    return {
      ready: false,
      checkedAt: Date.now(),
      origin,
      error: 'Бэкенд недоступен — поиск и прокси провайдеров работают в ограниченном режиме',
      search: {},
    };
  }
}

export interface SearchOptions {
  count?: number;
  provider?: SearchProviderId;
  secrets?: {
    braveApiKey?: string;
    tavilyApiKey?: string;
    serperApiKey?: string;
    searxngUrl?: string;
  };
}

export interface SearchOutcome {
  query: string;
  provider: SearchSource | 'open-api';
  hits: SearchHit[];
  answer: string | null;
  notice: string | null;
  tookMs: number;
  viaBackend: boolean;
}

export async function webSearch(
  query: string,
  backend: BackendStatus,
  options: SearchOptions = {},
): Promise<SearchOutcome> {
  const startedAt = Date.now();
  const count = Math.min(Math.max(options.count ?? 8, 1), 20);

  if (backend.ready) {
    try {
      const response = await fetch(apiUrl(backend.origin, '/api/search'), {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ query, count, provider: options.provider ?? 'auto', ...options.secrets }),
        signal: AbortSignal.timeout(25_000),
      });

      if (response.ok) {
        const payload = (await response.json()) as {
          provider: SearchSource;
          hits: SearchHit[];
          answer?: string | null;
          notice?: string | null;
        };

        return {
          query,
          provider: payload.provider,
          hits: payload.hits ?? [],
          answer: payload.answer ?? null,
          notice: payload.notice ?? null,
          tookMs: Date.now() - startedAt,
          viaBackend: true,
        };
      }
    } catch {
      /* переходим на открытые API прямо из браузера */
    }
  }

  const settled = await Promise.allSettled([
    wikipedia(query, count),
    hackerNews(query, count),
    githubRepos(query, Math.min(count, 5)),
  ]);

  const hits: SearchHit[] = [];
  for (const result of settled) {
    if (result.status === 'fulfilled') hits.push(...result.value);
  }

  return {
    query,
    provider: 'open-api',
    hits: hits.slice(0, count),
    answer: null,
    notice: backend.ready
      ? 'Серверный поиск не ответил, результаты собраны из открытых API'
      : 'Бэкенд недоступен: работают только Википедия, Hacker News и GitHub. Полный поиск появится после деплоя на Vercel',
    tookMs: Date.now() - startedAt,
    viaBackend: false,
  };
}

const READER_FALLBACK = 'https://r.jina.ai/';

export async function readPage(
  url: string,
  backend: BackendStatus,
  maxChars = 12_000,
): Promise<ExtractedPage & { notice: string | null }> {
  if (backend.ready) {
    const response = await fetch(apiUrl(backend.origin, '/api/read'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ url, maxChars, format: 'markdown' }),
      signal: AbortSignal.timeout(30_000),
    });

    const payload = (await response.json()) as (ExtractedPage & { error?: string }) | { error: string };

    if (!response.ok || 'error' in payload) {
      throw new Error(
        'error' in payload ? payload.error : `Сервер чтения ответил ${response.status}`,
      );
    }

    return { ...payload, notice: null };
  }

  const response = await fetch(`${READER_FALLBACK}${url}`, {
    headers: { accept: 'text/plain' },
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw new Error(
      `Страницу не открыть без бэкенда (читалка ответила ${response.status}). Задеплойте проект на Vercel — там чтение страниц работает полностью`,
    );
  }

  const body = await response.text();
  const truncated = body.length > maxChars;

  return {
    url,
    title: body.split('\n').find((line) => line.startsWith('Title:'))?.slice(6).trim() || url,
    description: null,
    siteName: null,
    published: null,
    text: truncated ? `${body.slice(0, maxChars)}\n…` : body,
    truncated,
    chars: body.length,
    notice: 'Страница прочитана через открытый сервис r.jina.ai: бэкенд недоступен',
  };
}

export { proxyUrl };
