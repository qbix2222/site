import { describe, expect, it } from 'vitest';
import type { UIMessage } from 'ai';
import { cleanTitle, titlePrompt } from './title';

const conversation: UIMessage[] = [
  { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Собери мне лендинг на React и посади на Vercel' }] },
  { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'Начну с каркаса проекта и конфигурации сборки.' }] },
];

describe('cleanTitle', () => {
  it('убирает кавычки, точки и лишние пробелы', () => {
    expect(cleanTitle('«Лендинг на React».\n')).toBe('Лендинг на React');
    expect(cleanTitle('"  Деплой на   Vercel "')).toBe('Деплой на Vercel');
  });

  it('берёт только первую строку ответа модели', () => {
    expect(cleanTitle('Первая строка\nвторая строка')).toBe('Первая строка');
  });

  it('поднимает первый символ и обрезает длинное название', () => {
    expect(cleanTitle('настройка провайдеров')).toBe('Настройка провайдеров');

    const long = cleanTitle('очень длинное название разговора которое точно не влезает в шапку списка');

    expect(long.length).toBeLessThanOrEqual(50);
    expect(long.endsWith('…')).toBe(true);
  });

  it('возвращает пустую строку для мусора', () => {
    expect(cleanTitle('   ')).toBe('');
    expect(cleanTitle('""')).toBe('');
  });
});

describe('titlePrompt', () => {
  it('собирает запрос и начало ответа', () => {
    const prompt = titlePrompt(conversation);

    expect(prompt).toContain('Собери мне лендинг');
    expect(prompt).toContain('каркаса проекта');
  });

  it('возвращает пустую строку, когда запроса пользователя ещё нет', () => {
    expect(titlePrompt([{ id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'привет' }] }])).toBe('');
  });

  it('обрезает очень длинный запрос', () => {
    const prompt = titlePrompt([
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'слово '.repeat(2_000) }] },
    ]);

    expect(prompt.length).toBeLessThan(1_800);
  });
});
