export interface ExtractedPage {
  url: string;
  title: string;
  description: string | null;
  siteName: string | null;
  published: string | null;
  text: string;
  truncated: boolean;
  chars: number;
}

export interface ExtractOptions {
  maxChars?: number;
  format?: 'text' | 'markdown';
}

const DROP_BLOCKS =
  /<(script|style|noscript|template|svg|iframe|form|nav|footer|aside|figure|button|select|option)[^>]*>[\s\S]*?<\/\1>/gi;

const SELF_CLOSED_DROP = /<(script|style|noscript|template|svg|iframe|form|nav|footer|aside)[^>]*\/?>/gi;

const COMMENT = /<!--[\s\S]*?-->/g;

const decode = (value: string): string =>
  value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&hellip;/g, '…')
    .replace(/&laquo;/g, '«')
    .replace(/&raquo;/g, '»')
    .replace(/&#(\d+);/g, (_match, digits: string) => String.fromCharCode(Number(digits)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) => String.fromCharCode(parseInt(hex, 16)));

const metaContent = (html: string, matcher: RegExp): string | null => {
  const found = html.match(matcher);
  if (!found) return null;

  const value = found[0].match(/content\s*=\s*"([^"]*)"|content\s*=\s*'([^']*)'/i);
  const raw = value?.[1] ?? value?.[2] ?? null;

  return raw ? decode(raw).trim() : null;
};

const tagInner = (html: string, matcher: RegExp): string | null => {
  const found = html.match(matcher);
  if (!found) return null;

  const inner = found[1]?.trim();

  return inner ? decode(inner) : null;
};

const attributeOf = (html: string, matcher: RegExp): string | null => {
  const found = html.match(matcher);
  const value = found?.[1] ?? null;

  return value ? decode(value).trim() : null;
};

function toMarkdown(body: string): string {
  return body
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (_m, inner: string) => `\n\n# ${plain(inner)}\n`)
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_m, inner: string) => `\n\n## ${plain(inner)}\n`)
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (_m, inner: string) => `\n\n### ${plain(inner)}\n`)
    .replace(/<h[4-6][^>]*>([\s\S]*?)<\/h[4-6]>/gi, (_m, inner: string) => `\n\n#### ${plain(inner)}\n`)
    .replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_m, inner: string) => `\n\n\`\`\`\n${plain(inner)}\n\`\`\`\n`)
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_m, inner: string) => `\`${plain(inner)}\``)
    .replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_m, inner: string) =>
      plain(inner)
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n'),
    )
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_m, inner: string) => `\n- ${plain(inner)}`)
    .replace(/<(p|div|section|article|tr|ul|ol|table)[^>]*>/gi, '\n\n')
    .replace(/<\/(p|div|section|article|tr|ul|ol|table)>/gi, '\n')
    .replace(/<(br|hr)\s*\/?>/gi, '\n')
    .replace(/<td[^>]*>([\s\S]*?)<\/td>/gi, (_m, inner: string) => ` ${plain(inner)} |`)
    .replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, inner: string) => {
      const label = plain(inner);
      return label && href ? `[${label}](${href})` : label;
    })
    .replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, (_m, inner: string) => `**${plain(inner)}**`)
    .replace(/<[^>]+>/g, ' ');
}

const plain = (value: string): string => decode(value.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();

export function extractPage(html: string, url: string, options: ExtractOptions = {}): ExtractedPage {
  const maxChars = options.maxChars ?? 12_000;
  const format = options.format ?? 'markdown';

  const title =
    tagInner(html, /<title[^>]*>([\s\S]*?)<\/title>/i) ??
    metaContent(html, /<meta[^>]+property=["']og:title["'][^>]*>/i) ??
    '';

  const description =
    metaContent(html, /<meta[^>]+name=["']description["'][^>]*>/i) ??
    metaContent(html, /<meta[^>]+property=["']og:description["'][^>]*>/i);

  const siteName = metaContent(html, /<meta[^>]+property=["']og:site_name["'][^>]*>/i);
  const published =
    attributeOf(html, /<meta[^>]+property=["']article:published_time["'][^>]*content=["']([^"']+)["']/i) ??
    attributeOf(html, /<meta[^>]+content=["']([^"']+)["'][^>]*property=["']article:published_time["']/i) ??
    attributeOf(html, /<time[^>]+datetime=["']([^"']+)["']/i);

  const cleaned = html
    .replace(COMMENT, ' ')
    .replace(DROP_BLOCKS, ' ')
    .replace(SELF_CLOSED_DROP, ' ');

  const main =
    cleaned.match(/<main[^>]*>([\s\S]*?)<\/main>/i)?.[1] ??
    cleaned.match(/<article[^>]*>([\s\S]*?)<\/article>/i)?.[1] ??
    cleaned.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] ??
    cleaned;

  const raw = format === 'markdown' ? toMarkdown(main) : plain(main);

  const normalized = decode(raw)
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const truncated = normalized.length > maxChars;
  const text = truncated ? `${normalized.slice(0, maxChars)}\n…` : normalized;

  return {
    url,
    title: plain(title) || url,
    description: description ? plain(description) : null,
    siteName: siteName ? plain(siteName) : null,
    published,
    text,
    truncated,
    chars: normalized.length,
  };
}

export const isProbablyHtml = (contentType: string | null, body: string): boolean =>
  (contentType?.includes('html') ?? false) || /^\s*<(?:!doctype|html|head|body)/i.test(body.slice(0, 512));

export function plainFromAny(body: string, contentType: string | null): string {
  if (contentType?.includes('json')) {
    try {
      return JSON.stringify(JSON.parse(body), null, 2);
    } catch {
      return body;
    }
  }

  return body;
}
