import type { WorkspaceNode } from '../core/types';
import { dirname, extensionOf } from './paths';

export function summarizeWorkspace(nodes: WorkspaceNode[]): string {
  if (!nodes.length) {
    return 'Рабочая папка этого чата пуста. Файлы появятся, когда пользователь добавит их или когда ты создашь их инструментами записи.';
  }

  const folders = new Map<string, number>();
  let totalBytes = 0;

  for (const node of nodes) {
    const folder = dirname(node.path) || '/';
    folders.set(folder, (folders.get(folder) ?? 0) + 1);
    totalBytes += node.size;
  }

  const shown = nodes.slice(0, 50);
  const lines = shown.map((node) => `- ${node.path} (${node.size} байт, ${node.origin})`);
  const more = nodes.length > shown.length ? `\n…и ещё ${nodes.length - shown.length} файл(ов)` : '';
  const folderLine = [...folders.entries()]
    .map(([folder, count]) => `${folder}: ${count}`)
    .join(', ');

  return [
    `В рабочей папке этого чата ${nodes.length} файл(ов), ${formatBytes(totalBytes)}.`,
    `Папки — ${folderLine}.`,
    'Список:',
    `${lines.join('\n')}${more}`,
    'Читай файл целиком перед правкой и не переписывай файл заново, если достаточно точечной правки.',
  ].join('\n');
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10_240 ? 1 : 0)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

export const kindLabel = (node: WorkspaceNode): string => {
  if (node.kind === 'dir') return 'папка';
  const extension = (extensionOf(node.path) ?? '').replace('.', '').toUpperCase();
  return extension || node.mediaType || 'файл';
};
