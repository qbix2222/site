import { tool, type ToolSet } from 'ai';
import { z } from 'zod';
import type { TurnSettings, WorkspaceNode } from '../core/types';
import { basename, joinPath, normalizePath } from '../workspace/paths';
import { applyEdits, diffLines } from '../workspace/patch';
import type { ExecutionRuntime, RunHandle } from '../runtime/types';

export const TOOL_NAMES = [
  'web_search',
  'web_read',
  'list_files',
  'read_file',
  'write_file',
  'patch_file',
  'delete_file',
  'search_files',
  'run_command',
  'run_javascript',
  'save_artifact',
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

export interface WorkspaceFileView {
  path: string;
  size: number;
  updatedAt: number;
  origin: WorkspaceNode['origin'];
}

export interface WebHit {
  title: string;
  url: string;
  snippet: string;
  published: string | null;
  source: string;
}

export interface WebSearchResult {
  query: string;
  provider: string;
  hits: WebHit[];
  answer: string | null;
  notice: string | null;
}

export interface WebReadResult {
  url: string;
  title: string;
  text: string;
  truncated: boolean;
  notice: string | null;
}

export interface AgentToolContext {
  readonly chatId: string;
  readonly runtimeKind: 'webcontainer' | 'local' | 'none';
  readonly runtime: ExecutionRuntime | null;
  webSearch(query: string, count: number): Promise<WebSearchResult>;
  webRead(url: string, maxChars: number): Promise<WebReadResult>;
  listFiles(): Promise<WorkspaceFileView[]>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, text: string): Promise<WorkspaceNode>;
  deleteFile(path: string): Promise<void>;
  logTerminal(stream: 'in' | 'out' | 'err' | 'sys', text: string): Promise<void>;
  notify(text: string, tone?: 'info' | 'warn' | 'danger'): void;
}

const pathSchema = z
  .string()
  .min(1)
  .describe('Относительный путь внутри рабочей папки чата, например src/index.ts');

const truncated = (text: string, limit: number): string =>
  text.length > limit ? `${text.slice(0, limit)}\n…обрезано, всего ${text.length} символов` : text;

async function pipeOutput(
  handle: RunHandle,
  context: AgentToolContext,
  limit: number,
): Promise<{ text: string; exitCode: number }> {
  const reader = handle.output.getReader();
  let text = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    text += value;
    await context.logTerminal('out', value);

    if (text.length >= limit) {
      text = `${text.slice(0, limit)}\n…вывод обрезан`;
      handle.kill();
      break;
    }
  }

  const exitCode = await handle.exit;
  await context.logTerminal('sys', `код возврата ${exitCode}`);
  return { text, exitCode };
}

export function buildAgentTools(
  context: AgentToolContext,
  settings: TurnSettings,
): ToolSet {
  const tools: ToolSet = {};

  if (settings.webEnabled) {
    tools.web_search = tool({
      description:
        'Поиск в интернете. Сам решай, когда он нужен: свежие факты и события, версии библиотек и API, документация, цены и тарифы, тексты ошибок, любые сведения, в которых ты не уверен или которые могли измениться после твоего обучения. Формулируй короткий конкретный запрос на языке источника: технические темы — по-английски, локальные — по-русски. Не ищи то, что уже лежит в рабочей папке.',
      inputSchema: z.object({
        query: z.string().min(2).max(200).describe('Поисковый запрос, например "vite 8 manualChunks function form"'),
        count: z.number().int().min(1).max(15).optional().describe('Сколько результатов вернуть, по умолчанию 6'),
      }),
      execute: async ({ query, count }) => {
        const result = await context.webSearch(query, count ?? 6);

        return {
          query: result.query,
          provider: result.provider,
          answer: result.answer,
          notice: result.notice,
          count: result.hits.length,
          results: result.hits.map((hit) => ({
            title: hit.title,
            url: hit.url,
            snippet: hit.snippet.slice(0, 400),
            published: hit.published,
          })),
          hint: 'Открой самую релевантную ссылку через web_read, если сниппета недостаточно. В ответе указывай URL источников.',
        };
      },
    });

    tools.web_read = tool({
      description:
        'Прочитать страницу по адресу: возвращает заголовок и текст в виде markdown. Используй после web_search, чтобы уточнить детали, или когда пользователь дал ссылку. Не читай больше двух-трёх страниц за ход — это дорого.',
      inputSchema: z.object({
        url: z.string().url().describe('Полный адрес страницы, https://…'),
        maxChars: z
          .number()
          .int()
          .min(1_000)
          .max(40_000)
          .optional()
          .describe('Потолок символов, по умолчанию 12000'),
      }),
      execute: async ({ url, maxChars }) => {
        const page = await context.webRead(url, maxChars ?? 12_000);

        return {
          url: page.url,
          title: page.title,
          truncated: page.truncated,
          notice: page.notice,
          text: truncated(page.text, maxChars ?? 12_000),
        };
      },
    });
  }

  if (settings.workspaceEnabled) {
    tools.list_files = tool({
      description:
        'Показать дерево файлов рабочей папки этого чата. Возвращает пути, размеры и автора последней правки.',
      inputSchema: z.object({
        prefix: z
          .string()
          .optional()
          .describe('Показывать только пути, начинающиеся с этого префикса'),
      }),
      execute: async ({ prefix }) => {
        const files = await context.listFiles();
        const filtered = prefix ? files.filter((file) => file.path.startsWith(prefix)) : files;
        return {
          count: filtered.length,
          files: filtered.map((file) => ({
            path: file.path,
            bytes: file.size,
            origin: file.origin,
          })),
        };
      },
    });

    tools.read_file = tool({
      description: 'Прочитать текстовое содержимое файла из рабочей папки чата.',
      inputSchema: z.object({ path: pathSchema }),
      execute: async ({ path }) => {
        const clean = normalizePath(path);
        const text = await context.readFile(clean);
        return {
          path: clean,
          bytes: new Blob([text]).size,
          content: truncated(text, 60_000),
        };
      },
    });

    tools.write_file = tool({
      description:
        'Создать файл или полностью перезаписать его. Для точечных правок используй patch_file — он дешевле и безопаснее.',
      inputSchema: z.object({
        path: pathSchema,
        content: z.string().describe('Полное содержимое файла'),
      }),
      execute: async ({ path, content }) => {
        const node = await context.writeFile(normalizePath(path), content);
        await context.logTerminal('sys', `записан ${node.path} (${node.size} байт)`);
        return { path: node.path, bytes: node.size, updatedAt: node.updatedAt };
      },
    });

    tools.patch_file = tool({
      description:
        'Точечно изменить файл: заменить один или несколько фрагментов. Фрагмент для поиска должен встречаться ровно один раз, иначе укажи replaceAll.',
      inputSchema: z.object({
        path: pathSchema,
        edits: z
          .array(
            z.object({
              search: z.string().min(1).describe('Точный фрагмент, который нужно найти'),
              replace: z.string().describe('Чем заменить найденный фрагмент'),
              replaceAll: z.boolean().optional().describe('Заменить все вхождения'),
            }),
          )
          .min(1),
        showDiff: z.boolean().optional().describe('Вернуть разницу построчно'),
      }),
      execute: async ({ path, edits, showDiff }) => {
        const clean = normalizePath(path);
        const before = await context.readFile(clean);
        const result = applyEdits(before, edits);

        if (!result.ok) {
          const failure = result.failure;
          const hint =
            failure.kind === 'not-found'
              ? 'Фрагмент не найден. Прочитай файл заново и скопируй текст точно, включая отступы.'
              : failure.kind === 'ambiguous'
                ? `Фрагмент встречается ${failure.matches} раз. Добавь соседние строки для уникальности или replaceAll.`
                : failure.kind === 'identical'
                  ? 'Замена совпадает с искомым текстом — менять нечего.'
                  : 'Пустой фрагмент для поиска.';
          return { ok: false as const, path: clean, reason: failure.kind, hint };
        }

        const node = await context.writeFile(clean, result.text);
        await context.logTerminal('sys', `изменён ${node.path} (правок: ${result.replaced})`);

        return {
          ok: true as const,
          path: node.path,
          replaced: result.replaced,
          bytes: node.size,
          diff: showDiff ? diffLines(before, result.text, 2) : undefined,
        };
      },
    });

    tools.delete_file = tool({
      description: 'Удалить файл или папку из рабочей папки чата.',
      inputSchema: z.object({ path: pathSchema }),
      execute: async ({ path }) => {
        const clean = normalizePath(path);
        await context.deleteFile(clean);
        await context.logTerminal('sys', `удалён ${clean}`);
        return { deleted: clean };
      },
    });

    tools.search_files = tool({
      description:
        'Найти строку или регулярное выражение по текстовым файлам рабочей папки. Возвращает совпадения с номерами строк.',
      inputSchema: z.object({
        query: z.string().min(1).describe('Строка или регулярное выражение'),
        isRegex: z.boolean().optional().describe('Воспринимать query как регулярное выражение'),
        prefix: z.string().optional().describe('Ограничить поиск папкой или префиксом пути'),
        maxMatches: z.number().int().min(1).max(200).optional().describe('Потолок совпадений'),
      }),
      execute: async ({ query, isRegex, prefix, maxMatches }) => {
        const limit = maxMatches ?? 50;
        const pattern = isRegex
          ? new RegExp(query, 'i')
          : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

        const files = await context.listFiles();
        const matches: Array<{ path: string; line: number; text: string }> = [];

        for (const file of files) {
          if (prefix && !file.path.startsWith(prefix)) continue;
          if (matches.length >= limit) break;

          const content = await context.readFile(file.path).catch(() => '');
          if (!content) continue;

          content.split('\n').forEach((text, index) => {
            if (matches.length >= limit) return;
            if (pattern.test(text)) {
              matches.push({ path: file.path, line: index + 1, text: text.trim().slice(0, 240) });
            }
          });
        }

        return { query, count: matches.length, truncatedByLimit: matches.length >= limit, matches };
      },
    });

    tools.save_artifact = tool({
      description:
        'Сохранить текстовый артефакт (отчёт, таблицу, черновик) в рабочую папку и показать его пользователю.',
      inputSchema: z.object({
        filename: z.string().min(1).describe('Имя файла, например report.md'),
        content: z.string().min(1).describe('Содержимое артефакта'),
        folder: z.string().optional().describe('Папка назначения, по умолчанию artifacts'),
      }),
      execute: async ({ filename, content, folder }) => {
        const path = normalizePath(joinPath(folder ?? 'artifacts', basename(filename)));
        const node = await context.writeFile(path, content);
        context.notify(`Артефакт сохранён: ${node.path}`);
        return { path: node.path, bytes: node.size };
      },
    });
  }

  if (settings.executionEnabled && context.runtime) {
    tools.run_command = tool({
      description:
        context.runtimeKind === 'webcontainer'
          ? 'Выполнить команду в песочнице Node.js (WebContainer): доступны node, npm, jiti, файловая система проекта.'
          : 'Выполнить команду. В локальном режиме доступна только интерпретация JavaScript — используй run_javascript.',
      inputSchema: z.object({
        command: z.string().min(1).describe('Команда, например npm run build'),
        cwd: z.string().optional().describe('Рабочая папка относительно корня песочницы'),
        timeoutMs: z.number().int().min(1000).max(300_000).optional(),
      }),
      execute: async ({ command, cwd, timeoutMs }) => {
        if (context.runtimeKind !== 'webcontainer') {
          return {
            ok: false as const,
            reason: 'local-runtime',
            hint: 'Локальный режим выполняет только JavaScript. Вызови run_javascript или включи песочницу WebContainer.',
          };
        }

        const runtime = context.runtime;
        if (!runtime) {
          return { ok: false as const, reason: 'no-runtime', hint: 'Среда исполнения недоступна.' };
        }

        await context.logTerminal('in', command);
        const handle = await runtime.run({
          command,
          cwd: cwd ? normalizePath(cwd) : undefined,
          timeoutMs: timeoutMs ?? 120_000,
        });
        const { text, exitCode } = await pipeOutput(handle, context, 60_000);

        return { ok: exitCode === 0, exitCode, output: truncated(text, 20_000) };
      },
    });
  }

  if (settings.executionEnabled) {
    tools.run_javascript = tool({
      description:
        'Выполнить фрагмент JavaScript и получить вывод консоли. В песочнице код запускается через node, в локальном режиме — как ES-модуль в изолированном потоке.',
      inputSchema: z.object({
        code: z.string().min(1).describe('Код для исполнения. Верхнеуровневый await разрешён.'),
        timeoutMs: z.number().int().min(500).max(60_000).optional(),
      }),
      execute: async ({ code, timeoutMs }) => {
        const runtime = context.runtime;
        if (!runtime) {
          return { ok: false as const, reason: 'no-runtime', hint: 'Среда исполнения недоступна.' };
        }

        await context.logTerminal('in', code.slice(0, 2000));

        if (context.runtimeKind === 'webcontainer') {
          const scriptPath = '.pult/snippet.mjs';
          await runtime.writeFile({ path: scriptPath, contents: code });
          const handle = await runtime.run({
            command: 'node',
            args: [scriptPath],
            timeoutMs: timeoutMs ?? 30_000,
          });
          const { text, exitCode } = await pipeOutput(handle, context, 40_000);
          return { ok: exitCode === 0, exitCode, output: truncated(text, 16_000) };
        }

        const handle = await runtime.run({
          command: code,
          timeoutMs: timeoutMs ?? 15_000,
        });
        const { text, exitCode } = await pipeOutput(handle, context, 40_000);

        return { ok: exitCode === 0, exitCode, output: truncated(text, 16_000) };
      },
    });
  }

  return tools;
}

export const toolLabel: Record<ToolName, string> = {
  web_search: 'поиск в интернете',
  web_read: 'чтение страницы',
  list_files: 'список файлов',
  read_file: 'чтение файла',
  write_file: 'запись файла',
  patch_file: 'правка файла',
  delete_file: 'удаление файла',
  search_files: 'поиск по файлам',
  run_command: 'команда в песочнице',
  run_javascript: 'исполнение JavaScript',
  save_artifact: 'сохранение артефакта',
};

export const labelForTool = (name: string): string =>
  toolLabel[name as ToolName] ?? name;
