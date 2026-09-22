import { describe, expect, it } from 'vitest';
import { applyEdit, applyEdits, diffLines } from './patch';

const source = [
  'export function greet(name: string) {',
  '  const phrase = `Привет, ${name}`;',
  '  return phrase;',
  '}',
].join('\n');

describe('applyEdit', () => {
  it('заменяет точное совпадение', () => {
    const result = applyEdit(source, {
      search: '  const phrase = `Привет, ${name}`;',
      replace: '  const phrase = `Здравствуй, ${name}`;',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text).toContain('Здравствуй');
    expect(result.text).not.toContain('Привет');
    expect(result.replaced).toBe(1);
  });

  it('отказывается от неоднозначной замены без флага', () => {
    const result = applyEdit('a\na\na', { search: 'a', replace: 'b' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toEqual({ kind: 'ambiguous', search: 'a', matches: 3 });
  });

  it('заменяет все вхождения по флагу', () => {
    const result = applyEdit('a\na\na', { search: 'a', replace: 'b', replaceAll: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text).toBe('b\nb\nb');
    expect(result.replaced).toBe(3);
  });

  it('прощает расхождения в отступах', () => {
    const result = applyEdit(source, {
      search: 'const phrase = `Привет, ${name}`;',
      replace: '  const phrase = `Привет, ${name}!`;',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text).toContain('Привет, ${name}!');
  });

  it('нормализует переводы строк Windows', () => {
    const windows = source.replace(/\n/g, '\r\n');
    const result = applyEdit(windows, { search: '  return phrase;', replace: '  return phrase.trim();' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text).toContain('return phrase.trim();');
    expect(result.text).not.toContain('\r\n');
  });

  it('сообщает, что искать нечего', () => {
    expect(applyEdit(source, { search: '   ', replace: 'x' }).ok).toBe(false);
    const result = applyEdit(source, { search: '   ', replace: 'x' });
    if (result.ok) return;
    expect(result.failure.kind).toBe('empty-search');
  });

  it('сообщает, что замена ничего не меняет', () => {
    const result = applyEdit(source, { search: '  return phrase;', replace: '  return phrase;' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.kind).toBe('identical');
  });

  it('сообщает, когда фрагмент не найден', () => {
    const result = applyEdit(source, { search: 'такого тут нет', replace: 'x' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.kind).toBe('not-found');
  });

  it('не ломается на специальных символах регулярных выражений', () => {
    const dotted = 'const re = /a.+b(c)?/;\nconst end = 1;';
    const result = applyEdit(dotted, {
      search: 'const re = /a.+b(c)?/;',
      replace: 'const re = /a.+b(c|d)?/;',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text).toContain('(c|d)');
  });
});

describe('applyEdits', () => {
  it('применяет правки последовательно', () => {
    const result = applyEdits(source, [
      { search: '  return phrase;', replace: '  return phrase.toUpperCase();' },
      { search: 'greet(name: string)', replace: 'greet(name = "мир")' },
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text).toContain('toUpperCase()');
    expect(result.text).toContain('greet(name = "мир")');
    expect(result.replaced).toBe(2);
  });

  it('останавливается на первой неудаче и не трогает файл', () => {
    const result = applyEdits(source, [
      { search: '  return phrase;', replace: '  return 1;' },
      { search: 'чего тут нет', replace: 'x' },
    ]);
    expect(result.ok).toBe(false);
  });
});

describe('diffLines', () => {
  it('показывает добавленные и удалённые строки', () => {
    const lines = diffLines('a\nb\nc', 'a\nB\nc', -1);
    expect(lines).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'remove', text: 'b' },
      { kind: 'add', text: 'B' },
      { kind: 'same', text: 'c' },
    ]);
  });

  it('сворачивает неизменённые участки в многоточие', () => {
    const before = Array.from({ length: 40 }, (_, index) => `строка ${index}`).join('\n');
    const after = before.replace('строка 20', 'строка 20 изменена');
    const lines = diffLines(before, after, 1);

    expect(lines.some((line) => line.text === '…')).toBe(true);
    expect(lines.some((line) => line.kind === 'add')).toBe(true);
    expect(lines.length).toBeLessThan(40);
  });

  it('не падает на пустых входах', () => {
    expect(diffLines('', '', -1)).toEqual([{ kind: 'same', text: '' }]);
  });
});
