export class InvalidPathError extends Error {
  constructor(readonly path: string, reason: string) {
    super(`Недопустимый путь «${path}»: ${reason}`);
    this.name = 'InvalidPathError';
  }
}

const MAX_DEPTH = 12;
const MAX_SEGMENT = 128;

export function normalizePath(raw: string): string {
  const value = raw.trim().replace(/\\/g, '/');
  if (!value) throw new InvalidPathError(raw, 'пустое имя');
  if (value.startsWith('/')) throw new InvalidPathError(raw, 'абсолютные пути запрещены');

  const segments = value.split('/').filter((segment) => segment.length > 0);
  if (!segments.length) throw new InvalidPathError(raw, 'пустое имя');
  if (segments.length > MAX_DEPTH) throw new InvalidPathError(raw, `глубже ${MAX_DEPTH} уровней`);

  const resolved: string[] = [];
  for (const segment of segments) {
    if (segment === '.') continue;
    if (segment === '..') throw new InvalidPathError(raw, 'выход за пределы рабочей папки');
    if (segment.length > MAX_SEGMENT) {
      throw new InvalidPathError(raw, `имя длиннее ${MAX_SEGMENT} символов`);
    }
    if (segment.includes('\u0000')) throw new InvalidPathError(raw, 'нулевой байт');
    resolved.push(segment);
  }

  if (!resolved.length) throw new InvalidPathError(raw, 'пустое имя');
  if (value.endsWith('/')) return resolved.join('/') + '/';
  return resolved.join('/');
}

export const isSafePath = (raw: string): boolean => {
  try {
    normalizePath(raw);
    return true;
  } catch {
    return false;
  }
};

export const dirname = (path: string): string => {
  const slash = path.lastIndexOf('/');
  return slash < 0 ? '' : path.slice(0, slash);
};

export const basename = (path: string): string => {
  const clean = path.endsWith('/') ? path.slice(0, -1) : path;
  const slash = clean.lastIndexOf('/');
  return slash < 0 ? clean : clean.slice(slash + 1);
};

export const joinPath = (...parts: string[]): string => {
  const joined = parts
    .map((part) => part.trim().replace(/^\/+|\/+$/g, ''))
    .filter((part) => part.length > 0)
    .join('/');
  return joined ? normalizePath(joined) : '';
};

export const extensionOf = (path: string): string => {
  const name = basename(path);
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return '';
  return name.slice(dot + 1).toLowerCase();
};

const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'markdown', 'json', 'jsonc', 'yaml', 'yml', 'toml', 'ini', 'env', 'csv', 'tsv',
  'xml', 'html', 'htm', 'css', 'scss', 'less', 'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'vue',
  'svelte', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift', 'c', 'h', 'cpp', 'hpp', 'cs', 'php',
  'sh', 'bash', 'zsh', 'fish', 'sql', 'graphql', 'gql', 'prisma', 'dockerfile', 'log', 'conf',
  'gitignore', 'editorconfig', 'svg', 'tex', 'rst', 'adoc', 'properties', 'lock',
]);

const MEDIA_TYPES: Record<string, string> = {
  txt: 'text/plain', md: 'text/markdown', json: 'application/json', yaml: 'text/yaml',
  yml: 'text/yaml', toml: 'text/toml', csv: 'text/csv', tsv: 'text/tab-separated-values',
  xml: 'application/xml', html: 'text/html', htm: 'text/html', css: 'text/css',
  js: 'text/javascript', mjs: 'text/javascript', cjs: 'text/javascript',
  jsx: 'text/javascript', ts: 'text/plain', tsx: 'text/plain', py: 'text/x-python',
  rs: 'text/x-rust', go: 'text/x-go', sh: 'application/x-sh', sql: 'application/sql',
  svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp',
  ico: 'image/x-icon', pdf: 'application/pdf', mp3: 'audio/mpeg', wav: 'audio/wav',
  ogg: 'audio/ogg', m4a: 'audio/mp4', flac: 'audio/flac', mp4: 'video/mp4',
  webm: 'video/webm', mov: 'video/quicktime', woff2: 'font/woff2', zip: 'application/zip',
};

export function mediaTypeOf(path: string, fallback = 'application/octet-stream'): string {
  const extension = extensionOf(path);
  const name = basename(path).toLowerCase();
  if (name === 'dockerfile') return 'text/plain';
  if (name === 'license') return 'text/plain';
  return MEDIA_TYPES[extension] ?? (TEXT_EXTENSIONS.has(extension) ? 'text/plain' : fallback);
}

export function isTextual(path: string, mediaType?: string | null): boolean {
  const type = mediaType ?? mediaTypeOf(path);
  if (type.startsWith('text/')) return true;
  if (type === 'application/json' || type === 'application/xml') return true;
  if (type === 'application/sql' || type === 'application/x-sh') return true;
  if (type === 'image/svg+xml') return true;
  return TEXT_EXTENSIONS.has(extensionOf(path));
}

export interface TreeEntry {
  name: string;
  path: string;
  kind: 'file' | 'dir';
  depth: number;
  children: TreeEntry[];
}

export function buildTree(paths: string[]): TreeEntry[] {
  const root: TreeEntry[] = [];
  const directories = new Map<string, TreeEntry>();

  for (const path of [...paths].sort((left, right) => left.localeCompare(right, 'ru'))) {
    const segments = path.split('/');
    let parent = root;
    let cursor = '';

    segments.forEach((segment, index) => {
      cursor = cursor ? `${cursor}/${segment}` : segment;
      const isFile = index === segments.length - 1;

      if (isFile) {
        parent.push({ name: segment, path: cursor, kind: 'file', depth: index, children: [] });
        return;
      }

      const existing = directories.get(cursor);
      if (existing) {
        parent = existing.children;
        return;
      }

      const entry: TreeEntry = {
        name: segment,
        path: cursor,
        kind: 'dir',
        depth: index,
        children: [],
      };
      directories.set(cursor, entry);
      parent.push(entry);
      parent = entry.children;
    });
  }

  sortTree(root);
  return root;
}

function sortTree(entries: TreeEntry[]): void {
  entries.sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === 'dir' ? -1 : 1;
    return left.name.localeCompare(right.name, 'ru');
  });
  for (const entry of entries) {
    if (entry.children.length) sortTree(entry.children);
  }
}

export function uniquePath(path: string, taken: Set<string>): string {
  if (!taken.has(path)) return path;

  const directory = dirname(path);
  const name = basename(path);
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : '';

  for (let counter = 2; counter < 1000; counter += 1) {
    const candidate = joinPath(directory, `${stem} ${counter}${extension}`);
    if (!taken.has(candidate)) return candidate;
  }

  return joinPath(directory, `${stem} ${Date.now()}${extension}`);
}
