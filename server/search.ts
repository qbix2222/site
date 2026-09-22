export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
  source: SearchSource;
  published?: string | null;
}

export type SearchSource =
  | 'duckduckgo'
  | 'brave'
  | 'tavily'
  | 'serper'
  | 'searxng'
  | 'wikipedia'
  | 'hackernews'
  | 'github';

export interface SearchRequest {
  query: string;
  count?: number;
  provider?: SearchSource | 'auto';
  region?: string;
  safeSearch?: 'off' | 'moderate' | 'strict';
}

export interface SearchResponse {
  query: string;
  provider: SearchSource;
  tookMs: number;
  hits: SearchHit[];
  answer?: string | null;
  notice?: string | null;
}

export interface SearchSecrets {
  brave?: string | null;
  tavily?: string | null;
  serper?: string | null;
  searxngUrl?: string | null;
}

const decodeEntities = (value: string): string =>
  value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_match, digits: string) => String.fromCharCode(Number(digits)));

const stripTags = (value: string): string => decodeEntities(value.replace(/<[^>]*>/g, '')).trim();

const unwrapRedirect = (href: string): string => {
  if (!href) return href;

  const absolute = href.startsWith('//') ? `https:${href}` : href;

  try {
    const url = new URL(absolute);
    const wrapped = url.searchParams.get('uddg');
    return wrapped ? decodeURIComponent(wrapped) : absolute;
  } catch {
    return absolute;
  }
};

function parseDuckDuckGo(html: string): SearchHit[] {
  const hits: SearchHit[] = [];
  const blocks = html.split(/class="[^"]*result\b[^"]*"/).slice(1);

  for (const block of blocks) {
    const link = block.match(/class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!link) continue;

    const snippet = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
    const url = unwrapRedirect(link[1]);

    if (!url.startsWith('http')) continue;

    hits.push({
      title: stripTags(link[2]),
      url,
      snippet: snippet ? stripTags(snippet[1]) : '',
      source: 'duckduckgo',
      published: null,
    });
  }

  return hits;
}

async function duckduckgo(
  request: SearchRequest,
  source: typeof fetch,
): Promise<SearchHit[]> {
  const form = new URLSearchParams({
    q: request.query,
    kl: request.region ?? 'wt-wt',
    ...(request.safeSearch ? { kf: request.safeSearch === 'off' ? '-2' : '1' } : {}),
  });

  const response = await source('https://html.duckduckgo.com/html/', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
      accept: 'text/html',
    },
    body: form.toString(),
  });

  if (!response.ok) throw new Error(`DuckDuckGo ответил ${response.status}`);

  const html = await response.text();
  const hits = parseDuckDuckGo(html);

  if (hits.length) return hits;

  const lite = await source(`https://lite.duckduckgo.com/lite/?${form.toString()}`, {
    headers: { accept: 'text/html', 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) Chrome/126' },
  });

  if (!lite.ok) return [];

  const liteHtml = await lite.text();
  const anchors = [...liteHtml.matchAll(/<a[^>]+href="([^"]+)"[^>]*class="result-link"[^>]*>([\s\S]*?)<\/a>/g)];

  return anchors.map((match) => ({
    title: stripTags(match[2]),
    url: unwrapRedirect(match[1]),
    snippet: '',
    source: 'duckduckgo' as const,
    published: null,
  }));
}

async function brave(request: SearchRequest, key: string, source: typeof fetch): Promise<SearchHit[]> {
  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q', request.query);
  url.searchParams.set('count', String(Math.min(request.count ?? 8, 20)));
  if (request.region) url.searchParams.set('country', request.region.slice(-2).toUpperCase());

  const response = await source(url, {
    headers: { accept: 'application/json', 'X-Subscription-Token': key },
  });

  if (!response.ok) throw new Error(`Brave ответил ${response.status}`);

  const payload = (await response.json()) as {
    web?: { results?: Array<{ title?: string; url?: string; description?: string; page_age?: string }> };
  };

  return (payload.web?.results ?? []).map((item) => ({
    title: item.title ?? '',
    url: item.url ?? '',
    snippet: item.description ?? '',
    source: 'brave' as const,
    published: item.page_age ?? null,
  }));
}

interface TavilyPayload {
  answer?: string | null;
  results?: Array<{ title?: string; url?: string; content?: string; published_date?: string }>;
}

async function tavily(request: SearchRequest, key: string, source: typeof fetch): Promise<{
  hits: SearchHit[];
  answer: string | null;
}> {
  const response = await source('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      api_key: key,
      query: request.query,
      max_results: Math.min(request.count ?? 8, 20),
      include_answer: true,
      search_depth: 'basic',
    }),
  });

  if (!response.ok) throw new Error(`Tavily ответил ${response.status}`);

  const payload = (await response.json()) as TavilyPayload;

  return {
    answer: payload.answer ?? null,
    hits: (payload.results ?? []).map((item) => ({
      title: item.title ?? '',
      url: item.url ?? '',
      snippet: item.content ?? '',
      source: 'tavily' as const,
      published: item.published_date ?? null,
    })),
  };
}

async function serper(request: SearchRequest, key: string, source: typeof fetch): Promise<SearchHit[]> {
  const response = await source('https://google.serper.dev/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-API-KEY': key },
    body: JSON.stringify({ q: request.query, num: Math.min(request.count ?? 8, 20), gl: 'ru', hl: 'ru' }),
  });

  if (!response.ok) throw new Error(`Serper ответил ${response.status}`);

  const payload = (await response.json()) as {
    organic?: Array<{ title?: string; link?: string; snippet?: string; date?: string }>;
  };

  return (payload.organic ?? []).map((item) => ({
    title: item.title ?? '',
    url: item.link ?? '',
    snippet: item.snippet ?? '',
    source: 'serper' as const,
    published: item.date ?? null,
  }));
}

async function searxng(
  request: SearchRequest,
  instance: string,
  source: typeof fetch,
): Promise<SearchHit[]> {
  const url = new URL('search', instance.endsWith('/') ? instance : `${instance}/`);
  url.searchParams.set('q', request.query);
  url.searchParams.set('format', 'json');

  const response = await source(url, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`SearXNG ответил ${response.status}`);

  const payload = (await response.json()) as {
    results?: Array<{ title?: string; url?: string; content?: string; publishedDate?: string; engine?: string }>;
  };

  return (payload.results ?? []).map((item) => ({
    title: item.title ?? '',
    url: item.url ?? '',
    snippet: item.content ?? '',
    source: 'searxng' as const,
    published: item.publishedDate ?? null,
  }));
}

export async function wikipedia(
  query: string,
  count: number,
  source: typeof fetch = fetch,
): Promise<SearchHit[]> {
  const url = new URL('https://ru.wikipedia.org/w/api.php');
  url.searchParams.set('action', 'query');
  url.searchParams.set('format', 'json');
  url.searchParams.set('origin', '*');
  url.searchParams.set('generator', 'search');
  url.searchParams.set('gsrsearch', query);
  url.searchParams.set('gsrlimit', String(Math.min(count, 20)));
  url.searchParams.set('prop', 'extracts');
  url.searchParams.set('exintro', '1');
  url.searchParams.set('explaintext', '1');

  const response = await source(url, { headers: { accept: 'application/json' } });
  if (!response.ok) return [];

  const payload = (await response.json()) as {
    query?: { pages?: Record<string, { title?: string; extract?: string; fullurl?: string; pageid?: number }> };
  };

  const pages = Object.values(payload.query?.pages ?? {});

  return pages.map((page) => ({
    title: page.title ?? '',
    url: page.fullurl ?? `https://ru.wikipedia.org/?curid=${page.pageid ?? 0}`,
    snippet: (page.extract ?? '').slice(0, 420),
    source: 'wikipedia' as const,
    published: null,
  }));
}

export async function hackerNews(
  query: string,
  count: number,
  source: typeof fetch = fetch,
): Promise<SearchHit[]> {
  const url = new URL('https://hn.algolia.com/api/v1/search');
  url.searchParams.set('query', query);
  url.searchParams.set('hitsPerPage', String(Math.min(count, 20)));

  const response = await source(url, { headers: { accept: 'application/json' } });
  if (!response.ok) return [];

  const payload = (await response.json()) as {
    hits?: Array<{ title?: string; url?: string; story_text?: string; created_at?: string; objectID?: string; story_title?: string }>;
  };

  return (payload.hits ?? []).map((item) => ({
    title: item.title ?? item.story_title ?? 'обсуждение',
    url: item.url ?? `https://news.ycombinator.com/item?id=${item.objectID ?? ''}`,
    snippet: stripTags(item.story_text ?? '').slice(0, 320),
    source: 'hackernews' as const,
    published: item.created_at ?? null,
  }));
}

export async function githubRepos(
  query: string,
  count: number,
  source: typeof fetch = fetch,
): Promise<SearchHit[]> {
  const url = new URL('https://api.github.com/search/repositories');
  url.searchParams.set('q', query);
  url.searchParams.set('per_page', String(Math.min(count, 10)));
  url.searchParams.set('sort', 'best-match');

  const response = await source(url, {
    headers: { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' },
  });

  if (!response.ok) return [];

  const payload = (await response.json()) as {
    items?: Array<{ full_name?: string; html_url?: string; description?: string; pushed_at?: string; stargazers_count?: number }>;
  };

  return (payload.items ?? []).map((item) => ({
    title: item.full_name ?? '',
    url: item.html_url ?? '',
    snippet: `${item.description ?? ''}${item.stargazers_count ? ` · ★ ${item.stargazers_count}` : ''}`,
    source: 'github' as const,
    published: item.pushed_at ?? null,
  }));
}

export interface SearchEnv {
  BRAVE_API_KEY?: string;
  TAVILY_API_KEY?: string;
  SERPER_API_KEY?: string;
  SEARXNG_URL?: string;
}

export const secretsFromEnv = (env: SearchEnv): SearchSecrets => ({
  brave: env.BRAVE_API_KEY ?? null,
  tavily: env.TAVILY_API_KEY ?? null,
  serper: env.SERPER_API_KEY ?? null,
  searxngUrl: env.SEARXNG_URL ?? null,
});

const pickProvider = (request: SearchRequest, secrets: SearchSecrets): SearchSource => {
  if (request.provider && request.provider !== 'auto') return request.provider;
  if (secrets.tavily) return 'tavily';
  if (secrets.brave) return 'brave';
  if (secrets.serper) return 'serper';
  if (secrets.searxngUrl) return 'searxng';
  return 'duckduckgo';
};

const dedupe = (hits: SearchHit[]): SearchHit[] => {
  const seen = new Set<string>();

  return hits.filter((hit) => {
    const key = hit.url.replace(/[#?].*$/, '').replace(/\/+$/, '').toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export async function searchWeb(
  request: SearchRequest,
  secrets: SearchSecrets = {},
  source: typeof fetch = fetch,
): Promise<SearchResponse> {
  const startedAt = Date.now();
  const count = Math.min(Math.max(request.count ?? 8, 1), 20);
  const provider = pickProvider(request, secrets);
  const notices: string[] = [];
  let answer: string | null = null;
  let hits: SearchHit[] = [];

  const attempt = async (name: SearchSource): Promise<void> => {
    if (name === 'brave' && secrets.brave) {
      hits = await brave(request, secrets.brave, source);
      return;
    }
    if (name === 'tavily' && secrets.tavily) {
      const result = await tavily(request, secrets.tavily, source);
      hits = result.hits;
      answer = result.answer;
      return;
    }
    if (name === 'serper' && secrets.serper) {
      hits = await serper(request, secrets.serper, source);
      return;
    }
    if (name === 'searxng' && secrets.searxngUrl) {
      hits = await searxng(request, secrets.searxngUrl, source);
      return;
    }
    if (name === 'duckduckgo') {
      hits = await duckduckgo(request, source);
      return;
    }
    if (name === 'wikipedia') {
      hits = await wikipedia(request.query, count, source);
      return;
    }
    if (name === 'hackernews') {
      hits = await hackerNews(request.query, count, source);
      return;
    }
    if (name === 'github') {
      hits = await githubRepos(request.query, count, source);
      return;
    }

    throw new Error(`Источник ${name} не настроен`);
  };

  try {
    await attempt(provider);
  } catch (error) {
    notices.push(
      `${provider}: ${error instanceof Error ? error.message : 'запрос не прошёл'} — пробую запасные источники`,
    );
  }

  if (!hits.length && provider !== 'duckduckgo') {
    try {
      hits = await duckduckgo(request, source);
      notices.push('результаты отданы через DuckDuckGo');
    } catch {
      /* DuckDuckGo тоже недоступен — ниже подключатся открытые API */
    }
  }

  if (!hits.length) {
    const open = await Promise.allSettled([
      wikipedia(request.query, count, source),
      hackerNews(request.query, count, source),
      githubRepos(request.query, Math.min(count, 5), source),
    ]);

    for (const result of open) {
      if (result.status === 'fulfilled') hits.push(...result.value);
    }

    if (hits.length) notices.push('поиск шёл по открытым API: Википедия, Hacker News, GitHub');
  }

  return {
    query: request.query,
    provider: hits[0]?.source ?? provider,
    tookMs: Date.now() - startedAt,
    hits: dedupe(hits).slice(0, count),
    answer,
    notice: notices.length ? notices.join('; ') : null,
  };
}
