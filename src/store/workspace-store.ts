import { create } from 'zustand';
import type { StoredWorkspaceNode } from './db';
import type { FileVersion } from './db';
import type { TerminalLine, WorkspaceNode } from '../core/types';
import { isTextual, mediaTypeOf, normalizePath, uniquePath } from '../workspace/paths';
import {
  appendTerminal,
  clearTerminal,
  deleteFile,
  getFile,
  listFiles,
  listTerminal,
  listVersions,
  putFile,
  renameFile,
} from './repository';

export interface WorkspaceState {
  chatId: string | null;
  nodes: StoredWorkspaceNode[];
  terminal: TerminalLine[];
  loading: boolean;
  selectedPath: string | null;
  open(path: string | null): void;
  load(chatId: string): Promise<void>;
  upload(chatId: string, files: File[]): Promise<{ added: string[]; rejected: string[] }>;
  write(chatId: string, path: string, text: string, origin: WorkspaceNode['origin']): Promise<StoredWorkspaceNode>;
  remove(chatId: string, path: string): Promise<void>;
  rename(chatId: string, from: string, to: string): Promise<void>;
  contentOf(path: string): Promise<string>;
  versionsOf(path: string): Promise<FileVersion[]>;
  log(chatId: string, stream: TerminalLine['stream'], text: string): Promise<void>;
  clearTerminal(chatId: string): Promise<void>;
}

const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;

async function readFileAsText(file: File): Promise<string> {
  return file.text();
}

async function readFileAsDataUrl(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;

  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }

  return `data:${file.type || mediaTypeOf(file.name)};base64,${btoa(binary)}`;
}

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  chatId: null,
  nodes: [],
  terminal: [],
  loading: false,
  selectedPath: null,

  open(path) {
    set({ selectedPath: path });
  },

  async load(chatId) {
    set({ loading: true, chatId });

    const [nodes, terminal] = await Promise.all([listFiles(chatId), listTerminal(chatId, 400)]);
    set({ nodes, terminal, loading: false });
  },

  async upload(chatId, files) {
    const taken = new Set(get().nodes.map((node) => node.path));
    const added: string[] = [];
    const rejected: string[] = [];

    for (const file of files) {
      if (file.size > MAX_UPLOAD_BYTES) {
        rejected.push(`${file.name}: больше 12 МБ`);
        continue;
      }

      const path = uniquePath(normalizePath(file.name), taken);
      taken.add(path);

      const textual = isTextual(path, file.type || undefined);
      const node = await putFile(
        chatId,
        path,
        textual ? { text: await readFileAsText(file) } : { dataUrl: await readFileAsDataUrl(file) },
        'user',
      );

      added.push(node.path);
    }

    if (added.length) {
      set({ nodes: await listFiles(chatId) });
    }

    return { added, rejected };
  },

  async write(chatId, path, text, origin) {
    const node = await putFile(chatId, path, { text }, origin);
    set({ nodes: await listFiles(chatId) });
    return node;
  },

  async remove(chatId, path) {
    await deleteFile(chatId, path);
    const nodes = await listFiles(chatId);
    set({
      nodes,
      selectedPath: get().selectedPath === path ? null : get().selectedPath,
    });
  },

  async rename(chatId, from, to) {
    await renameFile(chatId, from, to);
    const nodes = await listFiles(chatId);
    set({ nodes, selectedPath: get().selectedPath === from ? to : get().selectedPath });
  },

  async contentOf(path) {
    const cached = get().nodes.find((node) => node.path === path);
    if (cached?.text !== null && cached?.text !== undefined) return cached.text;

    const chatId = get().chatId;
    if (!chatId) return '';

    const stored = await getFile(chatId, path);
    return stored?.text ?? '';
  },

  async versionsOf(path) {
    const chatId = get().chatId;
    if (!chatId) return [];

    const node = await getFile(chatId, path);
    return node ? listVersions(node.id) : [];
  },

  async log(chatId, stream, text) {
    const lines = await appendTerminal(chatId, [{ stream, text }]);
    const terminal = [...get().terminal, ...lines].slice(-600);
    set({ terminal });
  },

  async clearTerminal(chatId) {
    await clearTerminal(chatId);
    set({ terminal: [] });
  },
}));

export const workspaceViews = (nodes: StoredWorkspaceNode[]): Array<{
  path: string;
  size: number;
  updatedAt: number;
  origin: WorkspaceNode['origin'];
}> =>
  nodes
    .filter((node) => node.kind === 'file')
    .map((node) => ({
      path: node.path,
      size: node.size,
      updatedAt: node.updatedAt,
      origin: node.origin,
    }));
