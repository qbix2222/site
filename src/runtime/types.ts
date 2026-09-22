import type { RuntimeKind, RuntimeStatus } from '../core/types';

export interface RunRequest {
  command: string;
  args?: string[];
  cwd?: string;
  stdin?: string;
  timeoutMs?: number;
}

export interface RunHandle {
  output: ReadableStream<string>;
  exit: Promise<number>;
  kill(): void;
}

export interface RuntimeFile {
  path: string;
  contents: string | Uint8Array;
}

export interface RuntimePort {
  port: number;
  url: string;
  at: number;
}

export interface ExecutionRuntime {
  readonly kind: RuntimeKind;
  status(): RuntimeStatus;
  start(): Promise<void>;
  stop(): void;
  writeFile(file: RuntimeFile): Promise<void>;
  readFile(path: string): Promise<string | Uint8Array>;
  remove(path: string): Promise<void>;
  reset(): Promise<void>;
  run(request: RunRequest): Promise<RunHandle>;
  onPort(listener: (port: RuntimePort) => void): () => void;
}

export const isCrossOriginIsolated = (): boolean =>
  typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated === true;

export function unavailableRuntime(reason: string, isolated: boolean): RuntimeStatus {
  return { kind: 'none', ready: false, reason, isolated };
}

export function readyRuntime(kind: RuntimeKind): RuntimeStatus {
  return { kind, ready: true, reason: null, isolated: isCrossOriginIsolated() };
}
