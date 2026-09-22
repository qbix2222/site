/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import type { WorkspaceNode } from '../core/types';
import { buildTree, splitCommand } from './webcontainer';
import { collectOutput, toRuntimeFiles } from './index';

function node(partial: Partial<WorkspaceNode> & { path: string }): WorkspaceNode {
  const name = partial.path.split('/').pop() ?? partial.path;
  return {
    id: partial.path,
    name,
    kind: 'file',
    size: 0,
    mediaType: null,
    createdAt: 0,
    updatedAt: 0,
    origin: 'user',
    text: null,
    dataUrl: null,
    ...partial,
  };
}

describe('buildTree', () => {
  it('раскладывает плоский список файлов по папкам', () => {
    const tree = buildTree([
      { path: 'src/lib/a.ts', contents: 'a' },
      { path: 'src/b.ts', contents: 'b' },
      { path: 'package.json', contents: '{}' },
    ]);

    expect(Object.keys(tree).sort()).toEqual(['package.json', 'src']);
    expect(tree['package.json']).toEqual({ file: { contents: '{}' } });

    const src = tree.src;
    if (!('directory' in src)) throw new Error('ожидалась папка');
    expect(Object.keys(src.directory).sort()).toEqual(['b.ts', 'lib']);

    const lib = src.directory.lib;
    if (!('directory' in lib)) throw new Error('ожидалась папка');
    expect(lib.directory['a.ts']).toEqual({ file: { contents: 'a' } });
  });

  it('принимает двоичное содержимое', () => {
    const tree = buildTree([{ path: 'logo.png', contents: new Uint8Array([1, 2, 3]) }]);
    const file = tree['logo.png'];
    if (!('file' in file) || !('contents' in file.file)) {
      throw new Error('ожидался файл');
    }
    expect(file.file.contents).toBeInstanceOf(Uint8Array);
  });

  it('возвращает пустое дерево без файлов', () => {
    expect(buildTree([])).toEqual({});
  });
});

describe('splitCommand', () => {
  it('разбирает простую команду', () => {
    expect(splitCommand('node index.js')).toEqual(['node', 'index.js']);
  });

  it('сохраняет аргументы в кавычках как один токен', () => {
    expect(splitCommand(`npm i -D "typescript vitest" 'single quoted'`)).toEqual([
      'npm',
      'i',
      '-D',
      'typescript vitest',
      'single quoted',
    ]);
  });

  it('переживает лишние пробелы', () => {
    expect(splitCommand('  ls   -la  ')).toEqual(['ls', '-la']);
    expect(splitCommand('')).toEqual([]);
  });
});

describe('toRuntimeFiles', () => {
  it('пропускает текстовые файлы в любом режиме', () => {
    const { files, skipped } = toRuntimeFiles([node({ path: 'a.md', text: 'текст' })], 'local');
    expect(files).toEqual([{ path: 'a.md', contents: 'текст' }]);
    expect(skipped).toEqual([]);
  });

  it('откладывает двоичные файлы в локальном режиме', () => {
    const { files, skipped } = toRuntimeFiles(
      [node({ path: 'logo.png', dataUrl: 'data:image/png;base64,AAEC' })],
      'local',
    );
    expect(files).toEqual([]);
    expect(skipped).toEqual(['logo.png']);
  });

  it('декодирует base64 для песочницы', () => {
    const { files } = toRuntimeFiles(
      [node({ path: 'logo.png', dataUrl: 'data:image/png;base64,AAEC' })],
      'webcontainer',
    );
    expect(files[0].contents).toEqual(new Uint8Array([0, 1, 2]));
  });

  it('декодирует процентное кодирование', () => {
    const { files } = toRuntimeFiles(
      [node({ path: 'note.txt', dataUrl: 'data:text/plain,привет' })],
      'webcontainer',
    );
    expect(files[0].contents).toBe('привет');
  });

  it('пропускает папки и битые ссылки', () => {
    const { files, skipped } = toRuntimeFiles(
      [node({ path: 'src', kind: 'dir' }), node({ path: 'broken.bin', dataUrl: 'без-запятой' })],
      'webcontainer',
    );
    expect(files).toEqual([]);
    expect(skipped).toEqual(['broken.bin']);
  });
});

describe('collectOutput', () => {
  it('собирает поток вывода и код возврата', async () => {
    const stream = new ReadableStream<string>({
      start(controller) {
        controller.enqueue('строка 1\n');
        controller.enqueue('строка 2\n');
        controller.close();
      },
    });

    const result = await collectOutput({ output: stream, exit: Promise.resolve(0), kill() {} });
    expect(result.text).toBe('строка 1\nстрока 2\n');
    expect(result.exitCode).toBe(0);
  });

  it('обрезает бесконечный вывод и останавливает процесс', async () => {
    let killed = false;
    const stream = new ReadableStream<string>({
      pull(controller) {
        controller.enqueue('x'.repeat(10_000));
      },
    });

    const result = await collectOutput({
      output: stream,
      exit: Promise.resolve(1),
      kill() {
        killed = true;
      },
    });

    expect(killed).toBe(true);
    expect(result.text.length).toBeLessThan(220_000);
    expect(result.text).toContain('вывод обрезан');
  });
});
