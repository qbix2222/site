import type { RuntimeStatus } from '../core/types';
import { isTextual, normalizePath } from '../workspace/paths';
import {
  type ExecutionRuntime,
  type RunHandle,
  type RunRequest,
  type RuntimeFile,
} from './types';
import LocalWorker from './local.worker?worker';

interface WorkerRequest {
  type: 'write' | 'read' | 'remove' | 'list' | 'reset' | 'exec';
  id: number;
  path?: string;
  contents?: string;
  code?: string;
}

interface WorkerLog {
  type: 'log';
  id: number;
  level: 'log' | 'info' | 'warn' | 'error' | 'debug';
  text: string;
}

interface WorkerExit {
  type: 'exit';
  id: number;
  exitCode: number;
  failure: string | null;
  runId: string;
}

interface WorkerResult {
  type: 'result';
  id: number;
  ok: boolean;
  value?: string | string[] | null;
}

type WorkerMessage = WorkerLog | WorkerExit | WorkerResult;

const KIND = 'local' as const;
const decoder = new TextDecoder();

export class LocalRuntime implements ExecutionRuntime {
  readonly kind = KIND;

  private worker: Worker | null = null;
  private sequence = 0;
  private pending = new Map<number, (message: WorkerResult) => void>();

  status(): RuntimeStatus {
    return {
      kind: KIND,
      ready: true,
      reason:
        'Локальный режим: выполняется только JavaScript в изолированном потоке. ' +
        'Полноценная оболочка с npm доступна в песочнице WebContainer.',
      isolated: typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated,
    };
  }

  async start(): Promise<void> {
    this.ensureWorker();
  }

  stop(): void {
    this.worker?.terminate();
    this.worker = null;
    this.pending.clear();
  }

  private ensureWorker(): Worker {
    if (!this.worker) {
      this.worker = new LocalWorker();
      this.worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
        const message = event.data;
        if (message.type === 'result') {
          const resolve = this.pending.get(message.id);
          if (resolve) {
            this.pending.delete(message.id);
            resolve(message);
          }
        }
      };
      this.worker.onerror = () => {
        this.worker?.terminate();
        this.worker = null;
        for (const resolve of this.pending.values()) {
          resolve({ type: 'result', id: -1, ok: false });
        }
        this.pending.clear();
      };
    }
    return this.worker;
  }

  private request(payload: Omit<WorkerRequest, 'id'>): Promise<WorkerResult> {
    const worker = this.ensureWorker();
    const id = ++this.sequence;

    return new Promise<WorkerResult>((resolve) => {
      this.pending.set(id, resolve);
      worker.postMessage({ ...payload, id } satisfies WorkerRequest);
    });
  }

  async writeFile(file: RuntimeFile): Promise<void> {
    const contents =
      typeof file.contents === 'string' ? file.contents : decoder.decode(file.contents);

    if (!isTextual(file.path)) {
      throw new Error('Локальный режим хранит только текстовые файлы');
    }

    await this.request({
      type: 'write',
      path: normalizePath(file.path),
      contents,
    });
  }

  async readFile(path: string): Promise<string> {
    const result = await this.request({ type: 'read', path: normalizePath(path) });
    return typeof result.value === 'string' ? result.value : '';
  }

  async remove(path: string): Promise<void> {
    await this.request({ type: 'remove', path: normalizePath(path) });
  }

  async reset(): Promise<void> {
    await this.request({ type: 'reset' });
  }

  async run(request: RunRequest): Promise<RunHandle> {
    const worker = this.ensureWorker();
    const id = ++this.sequence;
    const controller = new AbortController();

    const stream = new ReadableStream<string>({
      start: (streamController) => {
        const onMessage = (event: MessageEvent<WorkerMessage>) => {
          const message = event.data;
          if (message.id !== id) return;

          if (message.type === 'log') {
            streamController.enqueue(`[${message.level}] ${message.text}\n`);
            return;
          }

          if (message.type === 'exit') {
            if (message.failure) streamController.enqueue(`${message.failure}\n`);
            streamController.close();
            worker.removeEventListener('message', onMessage);
          }
        };

        worker.addEventListener('message', onMessage);
        controller.signal.addEventListener(
          'abort',
          () => {
            worker.removeEventListener('message', onMessage);
            streamController.close();
          },
          { once: true },
        );

        worker.postMessage({ type: 'exec', id, code: request.command } satisfies WorkerRequest);
      },
    });

    const timeoutMs = request.timeoutMs ?? 30_000;
    const exit = new Promise<number>((resolve) => {
      const timer = setTimeout(() => {
        controller.abort();
        resolve(124);
      }, timeoutMs);

      const onMessage = (event: MessageEvent<WorkerMessage>) => {
        const message = event.data;
        if (message.id !== id || message.type !== 'exit') return;
        clearTimeout(timer);
        worker.removeEventListener('message', onMessage);
        resolve(message.exitCode);
      };

      worker.addEventListener('message', onMessage);
      controller.signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          worker.removeEventListener('message', onMessage);
        },
        { once: true },
      );
    });

    return { output: stream, exit, kill: () => controller.abort() };
  }

  onPort(): () => void {
    return () => undefined;
  }
}

export const localRuntime = new LocalRuntime();
