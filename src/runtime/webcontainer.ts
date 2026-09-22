import type { RuntimeKind, RuntimeStatus } from '../core/types';
import { dirname, normalizePath } from '../workspace/paths';
import {
  isCrossOriginIsolated,
  type ExecutionRuntime,
  type RunHandle,
  type RunRequest,
  type RuntimeFile,
  type RuntimePort,
} from './types';

type WebContainerModule = typeof import('@webcontainer/api');
type WebContainerInstance = import('@webcontainer/api').WebContainer;
type FileSystemTree = import('@webcontainer/api').FileSystemTree;

const KIND: RuntimeKind = 'webcontainer';
const WORKDIR = 'app';

const ISOLATION_HINT =
  'Песочнице нужны заголовки Cross-Origin-Opener-Policy и Cross-Origin-Embedder-Policy. ' +
  'На GitHub Pages их задать нельзя — откройте приложение на Vercel или в локальной сборке.';

const BROWSER_HINT =
  'Песочница WebContainer работает в Chromium-браузерах и требует включённого SharedArrayBuffer.';

let modulePromise: Promise<WebContainerModule> | null = null;
let bootPromise: Promise<WebContainerInstance> | null = null;
let instance: WebContainerInstance | null = null;
let failure: string | null = null;

async function loadModule(): Promise<WebContainerModule> {
  if (!modulePromise) {
    modulePromise = import('@webcontainer/api');
  }
  return modulePromise;
}

async function boot(): Promise<WebContainerInstance> {
  if (instance) return instance;
  if (failure) throw new Error(failure);
  if (!bootPromise) {
    bootPromise = (async () => {
      const module = await loadModule();
      const booted = await module.WebContainer.boot({ coep: 'credentialless', workdirName: WORKDIR });
      instance = booted;
      return booted;
    })().catch((error: unknown) => {
      failure = error instanceof Error ? error.message : String(error);
      bootPromise = null;
      throw error;
    });
  }
  return bootPromise;
}

export function buildTree(files: RuntimeFile[]): FileSystemTree {
  const tree: FileSystemTree = {};

  for (const file of files) {
    const segments = normalizePath(file.path).split('/');
    let cursor = tree;

    segments.forEach((segment, index) => {
      if (index === segments.length - 1) {
        cursor[segment] = { file: { contents: file.contents } };
        return;
      }
      const existing = cursor[segment];
      if (existing && 'directory' in existing) {
        cursor = existing.directory;
        return;
      }
      const created: FileSystemTree = {};
      cursor[segment] = { directory: created };
      cursor = created;
    });
  }

  return tree;
}

export function splitCommand(command: string): string[] {
  const tokens: string[] = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;

  for (const match of command.matchAll(pattern)) {
    const [, double, single, bare] = match;
    tokens.push(double ?? single ?? bare ?? '');
  }

  return tokens;
}

async function readToString(
  fs: WebContainerInstance['fs'],
  path: string,
): Promise<string | Uint8Array> {
  try {
    return await fs.readFile(path, 'utf-8');
  } catch {
    return fs.readFile(path);
  }
}

const isChromium = (): boolean =>
  typeof navigator !== 'undefined' && /Chrome|Chromium|Edg|Opera/.test(navigator.userAgent);

async function ensureDirectory(
  fs: WebContainerInstance['fs'],
  path: string,
): Promise<void> {
  const parent = dirname(path);
  if (!parent) return;

  const segments = parent.split('/');
  let cursor = '';
  for (const segment of segments) {
    cursor = cursor ? `${cursor}/${segment}` : segment;
    try {
      await fs.mkdir(cursor, { recursive: true });
    } catch {
      continue;
    }
  }
}

export class WebContainerRuntime implements ExecutionRuntime {
  readonly kind = KIND;

  private ports = new Set<(port: RuntimePort) => void>();
  private unsubscribePort: (() => void) | null = null;
  private unsubscribeReady: (() => void) | null = null;

  status(): RuntimeStatus {
    const isolated = isCrossOriginIsolated();
    if (instance) return { kind: KIND, ready: true, reason: null, isolated };
    if (failure) return { kind: 'none', ready: false, reason: failure, isolated };
    if (!isolated) return { kind: 'none', ready: false, reason: ISOLATION_HINT, isolated };

    if (!isChromium()) return { kind: 'none', ready: false, reason: BROWSER_HINT, isolated };

    return { kind: 'none', ready: false, reason: null, isolated };
  }

  async start(): Promise<void> {
    if (!isCrossOriginIsolated()) {
      throw new Error(ISOLATION_HINT);
    }

    const container = await boot();
    this.attachEvents(container);
  }

  private attachEvents(container: WebContainerInstance): void {
    if (this.unsubscribePort) return;

    this.unsubscribePort = container.on('port', (port, url) => {
      const entry: RuntimePort = { port, url, at: Date.now() };
      for (const listener of this.ports) listener(entry);
    });

    this.unsubscribeReady = container.on('server-ready', (port, url) => {
      const entry: RuntimePort = { port, url, at: Date.now() };
      for (const listener of this.ports) listener(entry);
    });
  }

  stop(): void {
    this.unsubscribePort?.();
    this.unsubscribeReady?.();
    this.unsubscribePort = null;
    this.unsubscribeReady = null;
    instance?.teardown();
    instance = null;
    bootPromise = null;
    failure = null;
  }

  async writeFile(file: RuntimeFile): Promise<void> {
    const container = await boot();
    const path = normalizePath(file.path);
    await ensureDirectory(container.fs, path);
    await container.fs.writeFile(path, file.contents);
  }

  async readFile(path: string): Promise<string | Uint8Array> {
    const container = await boot();
    return readToString(container.fs, normalizePath(path));
  }

  async remove(path: string): Promise<void> {
    const container = await boot();
    await container.fs.rm(normalizePath(path), { force: true, recursive: true });
  }

  async reset(): Promise<void> {
    const container = await boot();
    const entries = await container.fs.readdir('.').catch(() => [] as string[]);
    await Promise.all(
      entries.map((entry) => container.fs.rm(entry, { force: true, recursive: true })),
    );
  }

  async mount(files: RuntimeFile[]): Promise<void> {
    const container = await boot();
    await container.mount(buildTree(files));
  }

  async run(request: RunRequest): Promise<RunHandle> {
    const container = await boot();
    const tokens = request.args?.length
      ? [request.command, ...request.args]
      : splitCommand(request.command);

    const [program, ...args] = tokens;
    if (!program) throw new Error('Пустая команда');

    const controller = new AbortController();
    const process = await container.spawn(program, args, {
      cwd: request.cwd ? normalizePath(request.cwd) : undefined,
      terminal: { cols: 100, rows: 30 },
    });

    if (request.stdin) {
      const writer = process.input.getWriter();
      await writer.write(request.stdin);
      await writer.close();
    }

    const timeout = request.timeoutMs ?? 120_000;
    const timer = setTimeout(() => controller.abort(), timeout);

    return {
      output: process.output,
      exit: process.exit.finally(() => clearTimeout(timer)),
      kill() {
        controller.abort();
        clearTimeout(timer);
        process.kill();
      },
    };
  }

  onPort(listener: (port: RuntimePort) => void): () => void {
    this.ports.add(listener);
    return () => this.ports.delete(listener);
  }
}

export const webContainerRuntime = new WebContainerRuntime();
