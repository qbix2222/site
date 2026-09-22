import { afterEach, describe, expect, it, vi } from 'vitest';
import { githubRepos, hackerNews, searchWeb, secretsFromEnv, wikipedia } from './search';

const DDG_HTML = `
<div class="result results_links results_links_deep web-result">
  <h2 class="result__title">
    <a rel="noopener" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fvercel.com%2Fdocs&amp;rut=abc">
      Vercel <b>Documentation</b>
    </a>
  </h2>
  <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fvercel.com%2Fdocs">
    Edge Functions &amp; serverless
  </a>
</div>
<div class="result results_links">
  <h2 class="result__title">
    <a class="result__a" href="https://example.com/second">Второй результат</a>
  </h2>
  <a class="result__snippet" href="https://example.com/second">Короткое описание</a>
</div>`;

const DDG_LITE_HTML = `
<table>
  <tr><td><a rel="nofollow" href="https://lite.example.com/page" class="result-link">Лёгкая выдача</a></td></tr>
</table>`;

const htmlResponse = (body: string): Response =>
  new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });

const jsonResponse = (payload: unknown): Response =>
  new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });

interface Call {
  url: string;
  init: RequestInit | undefined;
}

function routeFetch(
  routes: Array<[RegExp, () => Response | Promise<Response>]>,
): { source: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];

  const source = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });

    for (const [pattern, make] of routes) {
      if (pattern.test(url)) return make();
    }

    return new Response('не найдено', { status: 404 });
  }) as unknown as typeof fetch;

  return { source, calls };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('searchWeb через DuckDuckGo', () => {
  it('разбирает html-выдачу, чистит теги и разворачивает редирект', async () => {
    const { source, calls } = routeFetch([[ /duckduckgo/, () => htmlResponse(DDG_HTML) ]]);

    const result = await searchWeb({ query: 'vercel edge functions', count: 5 }, {}, source);

    expect(result.provider).toBe('duckduckgo');
    expect(result.notice).toBeNull();
    expect(result.hits).toHaveLength(2);
    expect(result.hits[0]).toMatchObject({
      title: 'Vercel Documentation',
      url: 'https://vercel.com/docs',
      snippet: 'Edge Functions & serverless',
      source: 'duckduckgo',
    });
    expect(calls[0].init?.method).toBe('POST');
    expect(String(calls[0].init?.body)).toContain('q=vercel+edge+functions');
  });

  it('переходит на лёгкую выдачу, когда основная пустая', async () => {
    const { source, calls } = routeFetch([
      [/html\.duckduckgo\.com/, () => htmlResponse('<div class="no-results">ничего</div>')],
      [/lite\.duckduckgo\.com/, () => htmlResponse(DDG_LITE_HTML)],
    ]);

    const result = await searchWeb({ query: 'редкий запрос' }, {}, source);

    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]).toMatchObject({ title: 'Лёгкая выдача', url: 'https://lite.example.com/page' });
    expect(calls).toHaveLength(2);
  });

  it('ограничивает число результатов и убирает повторы по адресу', async () => {
    const doubled = `${DDG_HTML}<div class="result"><a class="result__a" href="https://example.com/second/">Дубль</a><a class="result__snippet" href="#">описание</a></div>`;
    const { source } = routeFetch([[ /duckduckgo/, () => htmlResponse(doubled) ]]);

    const result = await searchWeb({ query: 'дубли', count: 2 }, {}, source);

    expect(result.hits).toHaveLength(2);
    expect(result.hits.map((hit) => hit.url)).toEqual(['https://vercel.com/docs', 'https://example.com/second']);
  });
});

describe('searchWeb с ключами', () => {
  it('выбирает Tavily первым и отдаёт готовый ответ', async () => {
    const { source, calls } = routeFetch([
      [
        /api\.tavily\.com/,
        () =>
          jsonResponse({
            answer: 'Edge Functions работают на V8.',
            results: [
              { title: 'Tavily hit', url: 'https://tavily.example/1', content: 'содержимое', published_date: '2026-02-01' },
            ],
          }),
      ],
    ]);

    const result = await searchWeb(
      { query: 'edge functions' },
      { tavily: 'tvly-key', brave: 'brv-key' },
      source,
    );

    expect(result.provider).toBe('tavily');
    expect(result.answer).toBe('Edge Functions работают на V8.');
    expect(result.hits[0]).toMatchObject({ title: 'Tavily hit', source: 'tavily', published: '2026-02-01' });
    expect(JSON.parse(String(calls[0].init?.body))).toMatchObject({ api_key: 'tvly-key', include_answer: true });
  });

  it('шлёт ключ Brave в заголовке подписки', async () => {
    const { source, calls } = routeFetch([
      [
        /api\.search\.brave\.com/,
        () => jsonResponse({ web: { results: [{ title: 'Brave hit', url: 'https://brave.example', description: 'описание' }] } }),
      ],
    ]);

    const result = await searchWeb({ query: 'поиск', region: 'ru-ru' }, { brave: 'brv-key' }, source);

    expect(result.provider).toBe('brave');
    expect(result.hits[0]).toMatchObject({ title: 'Brave hit', source: 'brave' });
    expect(calls[0].url).toContain('country=RU');
    expect((calls[0].init?.headers as Record<string, string>)['X-Subscription-Token']).toBe('brv-key');
  });

  it('читает выдачу Serper и SearXNG', async () => {
    const serper = routeFetch([
      [/google\.serper\.dev/, () => jsonResponse({ organic: [{ title: 'Serper hit', link: 'https://serper.example', snippet: 'фрагмент' }] })],
    ]);

    const serperResult = await searchWeb({ query: 'serper' }, { serper: 'sp-key' }, serper.source);
    expect(serperResult.hits[0]).toMatchObject({ title: 'Serper hit', url: 'https://serper.example', source: 'serper' });
    expect((serper.calls[0].init?.headers as Record<string, string>)['X-API-KEY']).toBe('sp-key');

    const searxng = routeFetch([
      [/searx\.example/, () => jsonResponse({ results: [{ title: 'SearXNG hit', url: 'https://searx.example/1', content: 'текст' }] })],
    ]);

    const searxngResult = await searchWeb(
      { query: 'searxng' },
      { searxngUrl: 'https://searx.example' },
      searxng.source,
    );
    expect(searxngResult.hits[0]).toMatchObject({ title: 'SearXNG hit', source: 'searxng' });
    expect(searxng.calls[0].url).toContain('format=json');
  });

  it('уважает явно выбранный источник', async () => {
    const { source } = routeFetch([
      [/wikipedia\.org/, () => jsonResponse({ query: { pages: { '1': { title: 'Вики', fullurl: 'https://ru.wikipedia.org/wiki/1', extract: 'текст' } } } })],
      [/api\.tavily\.com/, () => jsonResponse({ results: [] })],
    ]);

    const result = await searchWeb({ query: 'вики', provider: 'wikipedia' }, { tavily: 'tvly' }, source);

    expect(result.provider).toBe('wikipedia');
    expect(result.hits[0].title).toBe('Вики');
  });
});

describe('searchWeb при сбоях', () => {
  it('уходит на открытые API и объясняет это в заметке', async () => {
    const { source } = routeFetch([
      [/duckduckgo/, () => Promise.reject(new Error('fetch failed'))],
      [/wikipedia\.org/, () => jsonResponse({ query: { pages: { '7': { title: 'Открытый источник', fullurl: 'https://ru.wikipedia.org/wiki/7', extract: 'описание' } } } })],
      [/hn\.algolia\.com/, () => jsonResponse({ hits: [{ title: 'HN обсуждение', url: 'https://news.ycombinator.com/item?id=1' }] })],
      [/api\.github\.com/, () => jsonResponse({ items: [{ full_name: 'org/repo', html_url: 'https://github.com/org/repo', description: 'репозиторий', stargazers_count: 12 }] })],
    ]);

    const result = await searchWeb({ query: 'открытые api' }, {}, source);

    expect(result.hits.map((hit) => hit.source)).toEqual(['wikipedia', 'hackernews', 'github']);
    expect(result.notice).toContain('duckduckgo: fetch failed');
    expect(result.notice).toContain('открытым API');
  });

  it('переживает отказ ключевого источника и падение части открытых API', async () => {
    const { source } = routeFetch([
      [/api\.tavily\.com/, () => new Response('ошибка', { status: 500 })],
      [/duckduckgo/, () => new Response('бот-проверка', { status: 403 })],
      [/wikipedia\.org/, () => jsonResponse({ query: { pages: {} } })],
      [/hn\.algolia\.com/, () => Promise.reject(new Error('сеть легла'))],
      [/api\.github\.com/, () => jsonResponse({ items: [{ full_name: 'org/only', html_url: 'https://github.com/org/only' }] })],
    ]);

    const result = await searchWeb({ query: 'живучесть' }, { tavily: 'tvly' }, source);

    expect(result.hits).toHaveLength(1);
    expect(result.hits[0].source).toBe('github');
    expect(result.notice).toContain('Tavily ответил 500');
  });

  it('сообщает, что источник не настроен, и всё равно ищет', async () => {
    const { source } = routeFetch([
      [/duckduckgo/, () => htmlResponse(DDG_HTML)],
      [/api\.github\.com/, () => jsonResponse({ items: [] })],
    ]);

    const result = await searchWeb({ query: 'brave без ключа', provider: 'brave' }, {}, source);

    expect(result.notice).toContain('Источник brave не настроен');
    expect(result.hits.length).toBeGreaterThan(0);
  });
});

describe('открытые источники по отдельности', () => {
  it('википедия ограничивает длину фрагмента и держит ссылку', async () => {
    const { source, calls } = routeFetch([
      [
        /wikipedia\.org/,
        () => jsonResponse({ query: { pages: { '3': { pageid: 3, title: 'Статья', extract: 'слово '.repeat(400) } } } }),
      ],
    ]);

    const hits = await wikipedia('статья', 3, source);

    expect(hits[0].snippet.length).toBeLessThanOrEqual(420);
    expect(hits[0].url).toContain('curid=3');
    expect(calls[0].url).toContain('origin=*');
  });

  it('hacker news подставляет ссылку на обсуждение', async () => {
    const { source } = routeFetch([
      [/hn\.algolia\.com/, () => jsonResponse({ hits: [{ objectID: '42', story_text: '<p>текст</p>', created_at: '2026-01-01' }] })],
    ]);

    const hits = await hackerNews('запрос', 5, source);

    expect(hits[0]).toMatchObject({
      title: 'обсуждение',
      url: 'https://news.ycombinator.com/item?id=42',
      snippet: 'текст',
      published: '2026-01-01',
    });
  });

  it('github добавляет звёзды в описание', async () => {
    const { source, calls } = routeFetch([
      [/api\.github\.com/, () => jsonResponse({ items: [{ full_name: 'org/repo', html_url: 'https://github.com/org/repo', description: 'инструмент', stargazers_count: 340 }] })],
    ]);

    const hits = await githubRepos('инструмент', 4, source);

    expect(hits[0].snippet).toBe('инструмент · ★ 340');
    expect(calls[0].url).toContain('per_page=4');
  });

  it('источники возвращают пустой список вместо исключения', async () => {
    const failing = routeFetch([[/./, () => new Response('нет', { status: 503 })]]);

    expect(await wikipedia('x', 3, failing.source)).toEqual([]);
    expect(await hackerNews('x', 3, failing.source)).toEqual([]);
    expect(await githubRepos('x', 3, failing.source)).toEqual([]);
  });
});

describe('secretsFromEnv', () => {
  it('переводит переменные окружения в секреты поиска', () => {
    expect(secretsFromEnv({ BRAVE_API_KEY: 'b', SEARXNG_URL: 'https://s.example' })).toEqual({
      brave: 'b',
      tavily: null,
      serper: null,
      searxngUrl: 'https://s.example',
    });

    expect(secretsFromEnv({})).toEqual({ brave: null, tavily: null, serper: null, searxngUrl: null });
  });
});
