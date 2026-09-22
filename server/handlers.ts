import { extractPage, isProbablyHtml, plainFromAny } from './extract';
import { searchWeb, secretsFromEnv, type SearchSource } from './search';
import { decodeTarget } from './target';

export interface ServerEnv {
  BRAVE_API_KEY?: string;
  TAVILY_API_KEY?: string;
  SERPER_API_KEY?: string;
  SEARXNG_URL?: string;
  ALLOWED_ORIGIN?: string;
  PROXY_ALLOW_LOCAL?: string;
}

export const json = (payload: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });

export const text = (payload: string, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(payload, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', ...headers },
  });

const corsHeaders = (env: ServerEnv, request: Request): Record<string, string> => ({
  'access-control-allow-origin': env.ALLOWED_ORIGIN ?? '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers':
    'content-type,authorization,x-api-key,anthropic-version,anthropic-beta,anthropic-dangerous-direct-browser-access,x-goog-api-key,api-key,accept',
  'access-control-max-age': '86400',
  vary: request.headers.get('origin') ? 'Origin' : 'Accept-Encoding',
});

const readBody = async <T>(request: Request): Promise<T> => {
  if (request.method === 'GET') {
    const params = new URL(request.url).searchParams;
    return Object.fromEntries(params.entries()) as T;
  }

  try {
    return (await request.json()) as T;
  } catch {
    return {} as T;
  }
};

export async function handleSearch(request: Request, env: ServerEnv = {}): Promise<Response> {
  const cors = corsHeaders(env, request);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  const body = await readBody<{
    query?: string;
    q?: string;
    count?: number | string;
    provider?: SearchSource | 'auto';
    region?: string;
    braveApiKey?: string;
    tavilyApiKey?: string;
    serperApiKey?: string;
    searxngUrl?: string;
  }>(request);

  const query = (body.query ?? body.q ?? '').trim();
  if (!query) return json({ error: 'Пустой поисковый запрос' }, 400, cors);
  if (query.length > 400) return json({ error: 'Запрос длиннее 400 символов' }, 400, cors);

  const count = Number(body.count ?? 8);

  try {
    const fromEnv = secretsFromEnv(env);

    const result = await searchWeb(
      { query, count: Number.isFinite(count) ? count : 8, provider: body.provider ?? 'auto', region: body.region },
      {
        brave: body.braveApiKey?.trim() || fromEnv.brave,
        tavily: body.tavilyApiKey?.trim() || fromEnv.tavily,
        serper: body.serperApiKey?.trim() || fromEnv.serper,
        searxngUrl: body.searxngUrl?.trim() || fromEnv.searxngUrl,
      },
    );

    return json(result, 200, cors);
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : 'Поиск не удался' },
      502,
      cors,
    );
  }
}

const PRIVATE_HOST =
  /^(?:localhost|127\.|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|169\.254\.|0\.|\[?::1\]?|\[?fe80:|\[?fc|\[?fd)/i;

export async function handleRead(request: Request, env: ServerEnv = {}): Promise<Response> {
  const cors = corsHeaders(env, request);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  const body = await readBody<{ url?: string; maxChars?: number | string; format?: 'text' | 'markdown' }>(request);
  const target = (body.url ?? '').trim();

  if (!target) return json({ error: 'Не указан адрес страницы' }, 400, cors);

  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return json({ error: 'Адрес страницы не разбирается' }, 400, cors);
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return json({ error: 'Разрешены только http и https' }, 400, cors);
  }

  if (PRIVATE_HOST.test(url.hostname) && env.PROXY_ALLOW_LOCAL !== '1') {
    return json({ error: 'Локальные адреса закрыты со стороны сервера' }, 403, cors);
  }

  const maxChars = Math.min(Math.max(Number(body.maxChars ?? 12_000) || 12_000, 500), 60_000);

  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(25_000),
      headers: {
        accept: 'text/html,application/xhtml+xml,application/json;q=0.9,text/plain;q=0.8,*/*;q=0.5',
        'accept-language': 'ru,en;q=0.8',
        'user-agent':
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
      },
    });

    if (!response.ok) return json({ error: `Страница ответила ${response.status}`, status: response.status }, 502, cors);

    const contentType = response.headers.get('content-type');
    const raw = await response.text();

    if (!isProbablyHtml(contentType, raw)) {
      const body2 = plainFromAny(raw, contentType);
      return json(
        {
          url: response.url,
          title: response.url,
          description: null,
          siteName: null,
          published: null,
          text: body2.length > maxChars ? `${body2.slice(0, maxChars)}\n…` : body2,
          truncated: body2.length > maxChars,
          chars: body2.length,
        },
        200,
        cors,
      );
    }

    return json(extractPage(raw, response.url, { maxChars, format: body.format ?? 'markdown' }), 200, cors);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Не удалось открыть страницу';
    return json({ error: message.includes('timeout') ? 'Страница не ответила за 25 секунд' : message }, 502, cors);
  }
}

const FORWARD_HEADERS = [
  'authorization',
  'x-api-key',
  'api-key',
  'x-goog-api-key',
  'anthropic-version',
  'anthropic-beta',
  'anthropic-dangerous-direct-browser-access',
  'openai-organization',
  'openai-project',
  'content-type',
  'accept',
];

const RESPONSE_HEADERS = ['content-type', 'x-ratelimit-remaining', 'retry-after', 'anthropic-ratelimit-requests-reset'];

export async function handleProvider(request: Request, env: ServerEnv = {}): Promise<Response> {
  const cors = corsHeaders(env, request);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  const url = new URL(request.url);
  const marker = '/api/provider/';
  const index = url.pathname.indexOf(marker);

  if (index < 0) return json({ error: 'Не указан целевой провайдер' }, 400, cors);

  const rest = url.pathname.slice(index + marker.length);
  const slash = rest.indexOf('/');
  const encoded = slash < 0 ? rest : rest.slice(0, slash);
  const tail = slash < 0 ? '' : rest.slice(slash);

  let base: string;
  try {
    base = decodeTarget(encoded);
  } catch {
    return json({ error: 'Не удалось разобрать адрес провайдера' }, 400, cors);
  }

  let upstream: URL;
  try {
    upstream = new URL(`${base.replace(/\/+$/, '')}${tail}${url.search}`);
  } catch {
    return json({ error: 'Адрес провайдера не собирается' }, 400, cors);
  }

  if (upstream.protocol !== 'https:' && upstream.protocol !== 'http:') {
    return json({ error: 'Разрешены только http и https' }, 400, cors);
  }

  if (PRIVATE_HOST.test(upstream.hostname) && env.PROXY_ALLOW_LOCAL !== '1') {
    return json({ error: 'Локальные провайдеры доступны только напрямую из браузера' }, 403, cors);
  }

  const headers = new Headers({ 'user-agent': 'pult-console/1.0', 'accept-encoding': 'identity' });
  for (const name of FORWARD_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  try {
    const response = await fetch(upstream, {
      method: request.method,
      headers,
      body: request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.arrayBuffer(),
      signal: AbortSignal.timeout(300_000),
    });

    const out = new Headers();
    for (const name of RESPONSE_HEADERS) {
      const value = response.headers.get(name);
      if (value) out.set(name, value);
    }
    for (const [key, value] of Object.entries(cors)) out.set(key, value);

    return new Response(response.body, { status: response.status, headers: out });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Провайдер не ответил';
    return json(
      { error: message.includes('timeout') ? 'Провайдер не ответил за 5 минут' : message },
      502,
      cors,
    );
  }
}

export async function handleHealth(request: Request, env: ServerEnv = {}): Promise<Response> {
  const cors = corsHeaders(env, request);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  const secrets = secretsFromEnv(env);

  return json(
    {
      ok: true,
      search: {
        duckduckgo: true,
        brave: Boolean(secrets.brave),
        tavily: Boolean(secrets.tavily),
        serper: Boolean(secrets.serper),
        searxng: Boolean(secrets.searxngUrl),
      },
    },
    200,
    cors,
  );
}
