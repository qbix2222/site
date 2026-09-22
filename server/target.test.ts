import { describe, expect, it } from 'vitest';
import { PROXY_PREFIX, decodeTarget, encodeTarget, proxyUrl } from './target';

describe('encodeTarget и decodeTarget', () => {
  it('сохраняет адрес без потерь', () => {
    const base = 'https://api.anthropic.com/v1';

    expect(decodeTarget(encodeTarget(base))).toBe(base);
  });

  it('переживает кириллицу, пробелы и знаки', () => {
    const base = 'https://пример.рф/v1?ключ=значение&ещё=1 a+b/c=';

    expect(decodeTarget(encodeTarget(base))).toBe(base);
  });

  it('даёт значение, безопасное для пути URL', () => {
    const encoded = encodeTarget('https://api.example.com/v1?query=1&other=2');

    expect(encoded).not.toMatch(/[+/=]/);
    expect(decodeTarget(encoded)).toBe('https://api.example.com/v1?query=1&other=2');
  });

  it('не ломается на пустой строке', () => {
    expect(encodeTarget('')).toBe('');
    expect(decodeTarget('')).toBe('');
  });
});

describe('proxyUrl', () => {
  it('собирает адрес серверной функции с закодированным провайдером', () => {
    const url = proxyUrl('https://pult.vercel.app/', 'https://api.openai.com/v1');

    expect(url.startsWith(`https://pult.vercel.app${PROXY_PREFIX}`)).toBe(true);
    expect(url).toContain(encodeTarget('https://api.openai.com/v1'));
    expect(decodeTarget(url.slice(url.indexOf(PROXY_PREFIX) + PROXY_PREFIX.length))).toBe(
      'https://api.openai.com/v1',
    );
  });

  it('работает с пустым адресом бэкенда как относительный путь', () => {
    expect(proxyUrl('', 'https://api.openai.com/v1')).toBe(
      `${PROXY_PREFIX}${encodeTarget('https://api.openai.com/v1')}`,
    );
  });
});
