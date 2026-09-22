import { describe, expect, it } from 'vitest';
import {
  InvalidPathError,
  basename,
  buildTree,
  dirname,
  extensionOf,
  isSafePath,
  isTextual,
  joinPath,
  mediaTypeOf,
  normalizePath,
  uniquePath,
} from './paths';

describe('normalizePath', () => {
  it('схлопывает лишние сегменты', () => {
    expect(normalizePath('src//lib/./a.ts')).toBe('src/lib/a.ts');
    expect(normalizePath('  notes.md  ')).toBe('notes.md');
  });

  it('сохраняет завершающий слэш у папок', () => {
    expect(normalizePath('src/lib/')).toBe('src/lib/');
  });

  it('отклоняет выход за пределы рабочей папки', () => {
    expect(() => normalizePath('../../etc/passwd')).toThrow(InvalidPathError);
    expect(() => normalizePath('src/../../secret')).toThrow(InvalidPathError);
    expect(() => normalizePath('/etc/passwd')).toThrow(InvalidPathError);
  });

  it('отклоняет нулевой байт и слишком глубокие пути', () => {
    expect(() => normalizePath('a\u0000b.txt')).toThrow(InvalidPathError);
    expect(() => normalizePath(Array.from({ length: 14 }, (_, i) => `d${i}`).join('/'))).toThrow(
      InvalidPathError,
    );
  });

  it('приводит обратные слэши к прямым', () => {
    expect(normalizePath('src\\lib\\a.ts')).toBe('src/lib/a.ts');
  });

  it('сообщает о небезопасном пути без исключения', () => {
    expect(isSafePath('src/a.ts')).toBe(true);
    expect(isSafePath('../a.ts')).toBe(false);
    expect(isSafePath('')).toBe(false);
  });
});

describe('path parts', () => {
  it('разбирает путь на составляющие', () => {
    expect(dirname('src/lib/a.ts')).toBe('src/lib');
    expect(dirname('a.ts')).toBe('');
    expect(basename('src/lib/a.ts')).toBe('a.ts');
    expect(basename('src/lib/')).toBe('lib');
    expect(extensionOf('archive.tar.gz')).toBe('gz');
    expect(extensionOf('Dockerfile')).toBe('');
  });

  it('соединяет сегменты и нормализует результат', () => {
    expect(joinPath('src', 'lib', 'a.ts')).toBe('src/lib/a.ts');
    expect(joinPath('/src/', '/lib/')).toBe('src/lib');
    expect(() => joinPath('src', '..', '..')).toThrow(InvalidPathError);
  });
});

describe('mediaTypeOf', () => {
  it('определяет тип по расширению', () => {
    expect(mediaTypeOf('photo.png')).toBe('image/png');
    expect(mediaTypeOf('data.json')).toBe('application/json');
    expect(mediaTypeOf('notes.md')).toBe('text/markdown');
    expect(mediaTypeOf('binary.unknownext')).toBe('application/octet-stream');
  });

  it('распознаёт текстовые файлы без расширения', () => {
    expect(mediaTypeOf('Dockerfile')).toBe('text/plain');
    expect(isTextual('src/app.tsx')).toBe(true);
    expect(isTextual('photo.png')).toBe(false);
    expect(isTextual('notes.unknown', 'text/plain')).toBe(true);
  });
});

describe('buildTree', () => {
  it('строит вложенную структуру и сортирует папки выше файлов', () => {
    const tree = buildTree(['src/lib/a.ts', 'src/b.ts', 'readme.md', 'src/lib/c.ts']);

    expect(tree.map((entry) => entry.name)).toEqual(['src', 'readme.md']);

    const src = tree[0];
    expect(src.kind).toBe('dir');
    expect(src.children.map((entry) => entry.name)).toEqual(['lib', 'b.ts']);
    expect(src.children[0].children.map((entry) => entry.path)).toEqual([
      'src/lib/a.ts',
      'src/lib/c.ts',
    ]);
  });

  it('возвращает пустой список для пустого входа', () => {
    expect(buildTree([])).toEqual([]);
  });
});

describe('uniquePath', () => {
  it('подбирает свободное имя рядом с занятым', () => {
    const taken = new Set(['notes.md', 'notes 2.md']);
    expect(uniquePath('notes.md', taken)).toBe('notes 3.md');
    expect(uniquePath('free.md', taken)).toBe('free.md');
  });

  it('сохраняет папку в пути', () => {
    const taken = new Set(['src/a.ts']);
    expect(uniquePath('src/a.ts', taken)).toBe('src/a 2.ts');
  });
});
