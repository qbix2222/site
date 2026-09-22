interface DirectoryNode {
  directory: Record<string, DirectoryNode | FileNode>;
}

interface FileNode {
  file: { contents: string };
}

type TreeNode = DirectoryNode | FileNode;

interface RequestMessage {
  type: 'write' | 'read' | 'remove' | 'list' | 'reset' | 'exec';
  id: number;
  path?: string;
  contents?: string;
  code?: string;
}

const tree: DirectoryNode = { directory: {} };
let generation = 0;

const isDirectory = (node: TreeNode | undefined): node is DirectoryNode =>
  Boolean(node && 'directory' in node);

const isFile = (node: TreeNode | undefined): node is FileNode =>
  Boolean(node && 'file' in node);

function segmentsOf(path: string): string[] {
  return path
    .split('/')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0 && segment !== '.');
}

function resolve(segments: string[]): { parent: DirectoryNode; name: string } | null {
  let cursor = tree;

  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    const existing = cursor.directory[segment];

    if (isDirectory(existing)) {
      cursor = existing;
      continue;
    }
    if (existing) return null;

    const created: DirectoryNode = { directory: {} };
    cursor.directory[segment] = created;
    cursor = created;
  }

  return { parent: cursor, name: segments[segments.length - 1] };
}

function write(path: string, contents: string): boolean {
  const segments = segmentsOf(path);
  if (!segments.length) return false;

  const target = resolve(segments);
  if (!target) return false;

  target.parent.directory[target.name] = { file: { contents } };
  return true;
}

function read(path: string): string | null {
  const segments = segmentsOf(path);
  if (!segments.length) return null;

  let cursor: TreeNode | undefined = tree;
  for (const segment of segments) {
    if (!isDirectory(cursor)) return null;
    cursor = cursor.directory[segment];
  }

  return isFile(cursor) ? cursor.file.contents : null;
}

function remove(path: string): boolean {
  const segments = segmentsOf(path);
  if (!segments.length) return false;

  const target = resolve(segments);
  if (!target || !(target.name in target.parent.directory)) return false;

  delete target.parent.directory[target.name];
  return true;
}

function list(path: string): string[] {
  const segments = segmentsOf(path);
  let cursor: TreeNode | undefined = tree;

  for (const segment of segments) {
    if (!isDirectory(cursor)) return [];
    cursor = cursor.directory[segment];
  }

  if (!isDirectory(cursor)) return [];

  return Object.entries(cursor.directory).map(([name, node]) =>
    isDirectory(node) ? `${name}/` : name,
  );
}

function clear(): void {
  tree.directory = {};
}

function collectFiles(node: DirectoryNode, prefix: string, into: string[]): void {
  for (const [name, child] of Object.entries(node.directory)) {
    const path = prefix ? `${prefix}/${name}` : name;
    if (isDirectory(child)) collectFiles(child, path, into);
    else into.push(path);
  }
}

async function execute(id: number, code: string): Promise<void> {
  const files: string[] = [];
  collectFiles(tree, '', files);

  const originalConsole = globalThis.console;
  const patched = {} as Console;
  const levels = ['log', 'info', 'warn', 'error', 'debug'] as const;

  for (const level of levels) {
    patched[level] = (...values: unknown[]) => {
      const text = values
        .map((value) => {
          if (typeof value === 'string') return value;
          try {
            return JSON.stringify(value, null, 2);
          } catch {
            return String(value);
          }
        })
        .join(' ');
      postMessage({ type: 'log', id, level, text });
      originalConsole[level](...values);
    };
  }

  patched.table = patched.log;
  patched.trace = patched.log;
  patched.assert = patched.log;

  const runId = `${Date.now()}-${generation++}`;
  let exitCode = 0;
  let failure: string | null = null;

  globalThis.console = patched;
  (globalThis as Record<string, unknown>).__workspace = {
    files,
    readFile(path: string): string {
      const value = read(path);
      if (value === null) throw new Error(`Файл не найден: ${path}`);
      return value;
    },
    listFiles(prefix = ''): string[] {
      return files.filter((path) => path.startsWith(prefix));
    },
    runId,
  };

  const moduleUrl = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));

  try {
    await import(/* @vite-ignore */ `${moduleUrl}?run=${runId}`);
  } catch (error) {
    exitCode = 1;
    failure =
      error instanceof Error
        ? `${error.name}: ${error.message}\n${error.stack ?? ''}`
        : String(error);
  } finally {
    URL.revokeObjectURL(moduleUrl);
    globalThis.console = originalConsole;
    delete (globalThis as Record<string, unknown>).__workspace;
  }

  postMessage({ type: 'exit', id, exitCode, failure, runId });
}

self.onmessage = (event: MessageEvent<RequestMessage>) => {
  const message = event.data;

  switch (message.type) {
    case 'write':
      postMessage({
        type: 'result',
        id: message.id,
        ok: write(message.path ?? '', message.contents ?? ''),
      });
      break;
    case 'read':
      postMessage({ type: 'result', id: message.id, ok: true, value: read(message.path ?? '') });
      break;
    case 'remove':
      postMessage({ type: 'result', id: message.id, ok: remove(message.path ?? '') });
      break;
    case 'list':
      postMessage({ type: 'result', id: message.id, ok: true, value: list(message.path ?? '') });
      break;
    case 'reset':
      clear();
      postMessage({ type: 'result', id: message.id, ok: true });
      break;
    case 'exec':
      void execute(message.id, message.code ?? '');
      break;
  }
};

export type { RequestMessage };
