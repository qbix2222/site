import { describe, expect, it } from 'vitest';
import { extractPage, isProbablyHtml, plainFromAny } from './extract';

const PAGE = `<!doctype html>
<html lang="ru">
<head>
  <title>Пульт &mdash; консоль моделей</title>
  <meta name="description" content="Личная консоль для работы с моделями">
  <meta property="og:site_name" content="Пульт">
  <meta property="article:published_time" content="2026-03-11T09:00:00Z">
  <style>body { color: red }</style>
  <script>console.log('скрипт не должен попасть в текст')</script>
</head>
<body>
  <nav><a href="/home">Главная</a><a href="/docs">Документация</a></nav>
  <main>
    <h1>Заголовок раздела</h1>
    <p>Первый абзац с <strong>важным</strong> и ссылкой <a href="https://example.com/page">пример</a>.</p>
    <h2>Подзаголовок</h2>
    <ul><li>первый пункт</li><li>второй пункт</li></ul>
    <pre><code>const a = 1;</code></pre>
    <blockquote>Цитата в одну строку</blockquote>
    <table><tr><td>ячейка</td><td>вторая</td></tr></table>
    <p>Текст &laquo;в кавычках&raquo; и &#8212; тире.</p>
  </main>
  <footer>Подвал сайта</footer>
</body>
</html>`;

describe('extractPage', () => {
  const page = extractPage(PAGE, 'https://example.com/article');

  it('берёт заголовок из title и расшифровывает сущности', () => {
    expect(page.title).toBe('Пульт — консоль моделей');
  });

  it('собирает описание, название сайта и дату публикации', () => {
    expect(page.description).toBe('Личная консоль для работы с моделями');
    expect(page.siteName).toBe('Пульт');
    expect(page.published).toBe('2026-03-11T09:00:00Z');
  });

  it('вырезает скрипты, стили, навигацию и подвал', () => {
    expect(page.text).not.toContain('скрипт не должен');
    expect(page.text).not.toContain('color: red');
    expect(page.text).not.toContain('Подвал сайта');
    expect(page.text).not.toContain('Документация');
  });

  it('превращает разметку в markdown', () => {
    expect(page.text).toContain('# Заголовок раздела');
    expect(page.text).toContain('## Подзаголовок');
    expect(page.text).toContain('**важным**');
    expect(page.text).toContain('[пример](https://example.com/page)');
    expect(page.text).toContain('- первый пункт');
    expect(page.text).toContain('```\nconst a = 1;\n```');
    expect(page.text).toContain('> Цитата в одну строку');
    expect(page.text).toContain('ячейка |');
  });

  it('расшифровывает кавычки и тире в тексте', () => {
    expect(page.text).toContain('«в кавычках»');
    expect(page.text).toContain('—');
  });

  it('считает объём и обрезает по пределу', () => {
    const short = extractPage(PAGE, 'https://example.com/article', { maxChars: 120 });

    expect(short.truncated).toBe(true);
    expect(short.text.length).toBeLessThanOrEqual(124);
    expect(short.text.endsWith('…')).toBe(true);
    expect(short.chars).toBeGreaterThan(120);
    expect(page.truncated).toBe(false);
  });

  it('отдаёт обычный текст без markdown-разметки', () => {
    const plain = extractPage(PAGE, 'https://example.com/article', { format: 'text' });

    expect(plain.text).toContain('Заголовок раздела');
    expect(plain.text).not.toContain('# ');
    expect(plain.text).not.toContain('**');
  });

  it('берёт заголовок из og:title, когда title пуст', () => {
    const page = extractPage(
      '<html><head><meta property="og:title" content="Заголовок из og"></head><body><p>текст</p></body></html>',
      'https://example.com',
    );

    expect(page.title).toBe('Заголовок из og');
  });

  it('подставляет адрес вместо заголовка, если заголовка нет', () => {
    const page = extractPage('<html><body><p>текст без заголовка</p></body></html>', 'https://example.com/x');

    expect(page.title).toBe('https://example.com/x');
  });

  it('читает дату из тега time', () => {
    const page = extractPage(
      '<html><body><time datetime="2026-01-02">2 января</time><p>текст</p></body></html>',
      'https://example.com',
    );

    expect(page.published).toBe('2026-01-02');
  });
});

describe('isProbablyHtml', () => {
  it('верит типу содержимого и началу документа', () => {
    expect(isProbablyHtml('text/html; charset=utf-8', '')).toBe(true);
    expect(isProbablyHtml(null, '<!doctype html><html>')).toBe(true);
    expect(isProbablyHtml('application/json', '{"a":1}')).toBe(false);
    expect(isProbablyHtml('text/plain', 'обычный текст')).toBe(false);
  });
});

describe('plainFromAny', () => {
  it('форматирует JSON и оставляет прочий текст как есть', () => {
    expect(plainFromAny('{"a":1,"b":[2]}', 'application/json')).toBe('{\n  "a": 1,\n  "b": [\n    2\n  ]\n}');
    expect(plainFromAny('{"сломано', 'application/json')).toBe('{"сломано');
    expect(plainFromAny('просто текст', 'text/plain')).toBe('просто текст');
  });
});
