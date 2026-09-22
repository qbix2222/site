import type { RuntimeKind, WorkspaceNode } from '../core/types';
import { isTextual } from '../workspace/paths';
import { localRuntime } from './local';
import { webContainerRuntime } from './webcontainer';
import { isCrossOriginIsolated, type ExecutionRuntime } from './types';

export type {
  ExecutionRuntime,
  RunHandle,
  RunRequest,
  RuntimeFile,
  RuntimePort,
} from './types';
export { isCrossOriginIsolated } from './types';
export { buildTree, splitCommand, WebContainerRuntime } from './webcontainer';
export { LocalRuntime } from './local';

export type RuntimePreference = 'auto' | 'webcontainer' | 'local';

export interface RuntimeChoice {
  runtime: ExecutionRuntime;
  kind: RuntimeKind;
  fallbackReason: string | null;
}

const supportsSandbox = (): boolean =>
  isCrossOriginIsolated() &&
  typeof navigator !== 'undefined' &&
  /Chrome|Chromium|Edg|Opera/.test(navigator.userAgent);

export function chooseRuntime(preference: RuntimePreference): RuntimeChoice {
  const sandbox = supportsSandbox();

  if (preference === 'local' || !sandbox) {
    return {
      runtime: localRuntime,
      kind: 'local',
      fallbackReason:
        preference === 'local'
          ? null
          : 'Песочница WebContainer недоступна: нужны заголовки изоляции и Chromium-браузер',
    };
  }

  return { runtime: webContainerRuntime, kind: 'webcontainer', fallbackReason: null };
}

export interface WorkspaceSync {
  written: number;
  skipped: string[];
}

function decodeDataUrl(dataUrl: string): Uint8Array | string | null {
  const comma = dataUrl.indexOf(',');
  if (comma < 0) return null;

  const head = dataUrl.slice(0, comma);
  const payload = dataUrl.slice(comma + 1);

  if (head.includes('base64')) {
    return Uint8Array.from(atob(payload), (char) => char.charCodeAt(0));
  }
  return decodeURIComponent(payload);
}

export function toRuntimeFiles(
  nodes: WorkspaceNode[],
  kind: RuntimeKind,
): { files: Array<{ path: string; contents: string | Uint8Array }>; skipped: string[] } {
  const files: Array<{ path: string; contents: string | Uint8Array }> = [];
  const skipped: string[] = [];

  for (const node of nodes) {
    if (node.kind !== 'file') continue;

    if (node.text !== null) {
      files.push({ path: node.path, contents: node.text });
      continue;
    }

    if (kind !== 'webcontainer' || !node.dataUrl) {
      skipped.push(node.path);
      continue;
    }

    const contents = decodeDataUrl(node.dataUrl);
    if (contents === null) {
      skipped.push(node.path);
      continue;
    }
    files.push({ path: node.path, contents });
  }

  return { files, skipped };
}

export async function syncWorkspace(
  runtime: ExecutionRuntime,
  nodes: WorkspaceNode[],
): Promise<WorkspaceSync> {
  const { files, skipped } = toRuntimeFiles(nodes, runtime.kind);
  let written = 0;

  for (const file of files) {
    if (runtime.kind === 'local' && !isTextual(file.path)) {
      skipped.push(file.path);
      continue;
    }
    await runtime.writeFile(file);
    written += 1;
  }

  return { written, skipped: [...new Set(skipped)] };
}

export async function collectOutput(handle: {
  output: ReadableStream<string>;
  exit: Promise<number>;
  kill(): void;
}): Promise<{ text: string; exitCode: number }> {
  const reader = handle.output.getReader();
  const limit = 200_000;
  let text = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    text += value;
    if (text.length >= limit) {
      text = `${text.slice(0, limit)}\n…вывод обрезан на 200 000 символов`;
      handle.kill();
      break;
    }
  }

  return { text, exitCode: await handle.exit };
}
