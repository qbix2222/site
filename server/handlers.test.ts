import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleHealth, handleProvider, handleRead, handleSearch } from './handlers';
import type { SearchHit } from './search';
import { encodeTarget } from './target';

interface Payload {
  ok?: boolean;
  search?: Record<string, boolean>;
  error?: string;
  status?: number;
  query?: string;
  provider?: string;
  hits?: SearchHit[];
  title?: string;
  description?: string | null;
  text?: string;
  truncated?: boolean;
}

const payloadOf = async (response: Response): Promise<Payload> => (await response.json()) as Payload;

const PAGE = `<!doctype html><html><head><title>Статья про деплой</title>
<meta name="description" content="Как развернуть сайт"></head>
<body><nav><a href="/">Главная</a></nav><main><h1>Деплой</h1><p>Текст статьи.</p></main></body></html>`;

const post = (url: string, body: unknown, headers: Record<string, string> = {}): Request =>
  new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

const stubFetch = (make: (url: string, init?: RequestInit) => Response | Promise<Response>): (() => string[]) => {
  const seen: string[] = [];

  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    seen.push(url);
    return make(url, init);
  });

  return () => seen;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('handleHealth', () => {
  it('показывает, какие источники поиска настроены', async () => {
    const response = await handleHealth(new Request('https://pult.example/api/health'), {
      BRAVE_API_KEY: 'brv',
    });
    const payload = await payloadOf(response);

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      ok: true,
      search: { duckduckgo: true, brave: true, tavily: false, serper: false, searxng: false },
    });
  });

  it('отвечает на предзапрос CORS без тела', async () => {
    const response = await handleHealth(
      new Request('https://pult.example/api/health', { method: 'OPTIONS', headers: { origin: 'https://site.example' } }),
      { ALLOWED_ORIGIN: 'https://site.example' },
    );

    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('https://site.example');
    expect(response.headers.get('vary')).toBe('Origin');
    expect(response.headers.get('access-control-allow-headers')).toContain('anthropic-version');
  });
});

describe('handleSearch', () => {
  it('отклоняет пустой и слишком длинный запрос', async () => {
    const empty = await handleSearch(post('https://pult.example/api/search', { query: '   ' }));
    expect(empty.status).toBe(400);
    expect(await payloadOf(empty)).toEqual({ error: 'Пустой поисковый запрос' });

    const long = await handleSearch(post('https://pult.example/api/search', { query: 'с'.repeat(401) }));
    expect(long.status).toBe(400);

    const viaQuery = await handleSearch(new Request('https://pult.example/api/search?q=запрос'));
    expect(viaQuery.status).toBe(200);
  });

  it('ищет и отдаёт заголовки CORS', async () => {
    stubFetch((url) =>
      url.includes('duckduckgo')
        ? new Response(
            `<div class="result"><a class="result__a" href="https://vercel.com/docs">Документация</a><a class="result__snippet" href="#">описание</a></div>`,
            { status: 200, headers: { 'content-type': 'text/html' } },
          )
        : new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
    );

    const response = await handleSearch(post('https://pult.example/api/search', { query: 'vercel', count: 3 }));
    const payload = await payloadOf(response);

    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(payload.hits?.[0]).toMatchObject({ title: 'Документация', url: 'https://vercel.com/docs' });
    expect(payload.query).toBe('vercel');
  });

  it('принимает ключ из запроса, когда на сервере его нет', async () => {
    const seen = stubFetch((url) =>
      url.includes('tavily')
        ? new Response(JSON.stringify({ results: [{ title: 'Tavily', url: 'https://t.example' }] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        : new Response('нет', { status: 404 }),
    );

    const response = await handleSearch(
      post('https://pult.example/api/search', { query: 'поиск', tavilyApiKey: 'tvly-from-client' }),
    );
    const payload = await payloadOf(response);

    expect(payload.provider).toBe('tavily');
    expect(seen()).toContain('https://api.tavily.com/search');
  });
});

describe('handleRead', () => {
  it('отклоняет пустой адрес, чужую схему и локальный хост', async () => {
    expect((await handleRead(post('https://pult.example/api/read', {}))).status).toBe(400);

    const ftp = await handleRead(post('https://pult.example/api/read', { url: 'ftp://files.example/x' }));
    expect(ftp.status).toBe(400);
    expect(await payloadOf(ftp)).toEqual({ error: 'Разрешены только http и https' });

    const broken = await handleRead(post('https://pult.example/api/read', { url: 'не адрес' }));
    expect(broken.status).toBe(400);

    const local = await handleRead(post('https://pult.example/api/read', { url: 'http://127.0.0.1:1234/v1' }));
    expect(local.status).toBe(403);
    expect(await payloadOf(local)).toEqual({ error: 'Локальные адреса закрыты со стороны сервера' });
  });

  it('разрешает локальный адрес только в режиме разработки', async () => {
    stubFetch(() => new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } }));

    const response = await handleRead(
      post('https://pult.example/api/read', { url: 'http://localhost:11434/api/tags' }),
      { PROXY_ALLOW_LOCAL: '1' },
    );
    const payload = await payloadOf(response);

    expect(response.status).toBe(200);
    expect(payload.text).toContain('"ok": true');
  });

  it('извлекает страницу в markdown', async () => {
    stubFetch(() => new Response(PAGE, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } }));

    const response = await handleRead(post('https://pult.example/api/read', { url: 'https://example.com/post', maxChars: 4000 }));
    const payload = await payloadOf(response);

    expect(response.status).toBe(200);
    expect(payload.title).toBe('Статья про деплой');
    expect(payload.description).toBe('Как развернуть сайт');
    expect(payload.text).toContain('# Деплой');
    expect(payload.text).not.toContain('Главная');
    expect(payload.truncated).toBe(false);
  });

  it('сообщает об отказе страницы', async () => {
    stubFetch(() => new Response('нет доступа', { status: 403 }));

    const response = await handleRead(post('https://pult.example/api/read', { url: 'https://example.com/closed' }));
    const payload = await payloadOf(response);

    expect(response.status).toBe(502);
    expect(payload).toEqual({ error: 'Страница ответила 403', status: 403 });
  });

  it('возвращает ошибку сети как 502', async () => {
    stubFetch(() => Promise.reject(new Error('fetch failed')));

    const response = await handleRead(post('https://pult.example/api/read', { url: 'https://example.com/x' }));

    expect(response.status).toBe(502);
    expect((await payloadOf(response)).error).toBe('fetch failed');
  });
});

describe('handleProvider', () => {
  const proxyRequest = (
    target: string,
    path: string,
    init: RequestInit = {},
  ): Request =>
    new Request(`https://pult.example/api/provider/${encodeTarget(target)}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-5' }),
      ...init,
    });

  it('отклоняет запрос без цели и с локальным адресом', async () => {
    const noTarget = await handleProvider(new Request('https://pult.example/api/other'));
    expect(noTarget.status).toBe(400);

    const local = await handleProvider(proxyRequest('http://127.0.0.1:1234/v1', '/chat/completions'));
    expect(local.status).toBe(403);
    expect((await payloadOf(local)).error).toContain('Локальные провайдеры');
  });

  it('принимает локального провайдера при разрешении', async () => {
    stubFetch(() => new Response('{"done":true}', { status: 200, headers: { 'content-type': 'application/json' } }));

    const response = await handleProvider(
      proxyRequest('http://localhost:11434/v1', '/chat/completions'),
      { PROXY_ALLOW_LOCAL: '1' },
    );

    expect(response.status).toBe(200);
  });

  it('переносит ключ, метод, тело и заголовки провайдера', async () => {
    const captured: { url?: string; init?: RequestInit } = {};

    vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
      captured.url = String(input);
      captured.init = init;

      return new Response('{"choices":[]}', {
        status: 201,
        headers: {
          'content-type': 'application/json',
          'x-ratelimit-remaining': '17',
          'retry-after': '3',
          'set-cookie': 'secret=1',
        },
      });
    });

    const response = await handleProvider(
      proxyRequest('https://api.openai.com/v1', '/chat/completions?beta=1', {
        headers: { authorization: 'Bearer sk-secret', 'content-type': 'application/json', cookie: 'session=abc' },
      }),
    );

    expect(response.status).toBe(201);
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(response.headers.get('x-ratelimit-remaining')).toBe('17');
    expect(response.headers.get('retry-after')).toBe('3');
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(response.headers.get('access-control-allow-origin')).toBe('*');

    const init = captured.init;
    expect(captured.url).toBe('https://api.openai.com/v1/chat/completions?beta=1');
    expect(init?.method).toBe('POST');

    const headers = init?.headers as Headers;
    expect(headers.get('authorization')).toBe('Bearer sk-secret');
    expect(headers.get('cookie')).toBeNull();
    expect(headers.get('user-agent')).toBe('pult-console/1.0');
  });

  it('сообщает о недоступности провайдера', async () => {
    stubFetch(() => Promise.reject(new Error('connection refused')));

    const response = await handleProvider(proxyRequest('https://api.openai.com/v1', '/models'));

    expect(response.status).toBe(502);
    expect((await payloadOf(response)).error).toBe('connection refused');
  });
});
