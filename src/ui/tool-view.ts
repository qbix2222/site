import type { ToolUIPart } from 'ai';

type AnyToolPart = ToolUIPart & {
  toolCallId?: string;
  state?: string;
  input?: Record<string, unknown>;
  output?: unknown;
  errorText?: string;
  approval?: { id: string; requestReason?: string };
};

export const asToolPart = (part: unknown): AnyToolPart => part as AnyToolPart;

export function toolHeadline(input: Record<string, unknown> | undefined): string {
  if (!input) return '';

  const command = input.command;
  if (typeof command === 'string') return command;

  const code = input.code;
  if (typeof code === 'string') return firstLine(code);

  const path = input.path;
  if (typeof path === 'string') {
    const folder = input.folder;
    return typeof folder === 'string' ? `${folder}/${path}` : path;
  }

  const query = input.query;
  if (typeof query === 'string') return query;

  const filename = input.filename;
  if (typeof filename === 'string') return filename;

  const prefix = input.prefix;
  if (typeof prefix === 'string') return prefix;

  const edits = input.edits;
  if (Array.isArray(edits) && edits.length) {
    const first = edits[0] as { search?: unknown };
    return typeof first.search === 'string' ? firstLine(first.search) : `${edits.length} правок`;
  }

  return firstLine(JSON.stringify(input) ?? '');
}

export function toolBody(input: Record<string, unknown> | undefined): string | null {
  if (!input) return null;

  const content = input.content;
  if (typeof content === 'string') return content;

  const code = input.code;
  if (typeof code === 'string') return code;

  const edits = input.edits;
  if (Array.isArray(edits) && edits.length) {
    return edits
      .map((edit) => {
        const item = edit as { search?: unknown; replace?: unknown };
        const search = typeof item.search === 'string' ? item.search : '';
        const replace = typeof item.replace === 'string' ? item.replace : '';
        return `— ${search}\n+ ${replace}`;
      })
      .join('\n\n');
  }

  return null;
}

export function outputText(output: unknown): string {
  if (typeof output === 'string') return output;

  if (output && typeof output === 'object') {
    const record = output as Record<string, unknown>;

    if (typeof record.output === 'string') return record.output;
    if (typeof record.content === 'string') return record.content;
    if (typeof record.hint === 'string') return record.hint;

    try {
      return JSON.stringify(output, null, 2);
    } catch {
      return String(output);
    }
  }

  return output === null || output === undefined ? '' : String(output);
}

export function outputSummary(output: unknown): string {
  const text = outputText(output);
  const lines = text.split('\n');
  return lines.length > 6 ? `${lines.slice(0, 6).join('\n')}\n…` : text;
}

const firstLine = (text: string): string => {
  const line = text.split('\n')[0].trim();
  return line.length > 90 ? `${line.slice(0, 90)}…` : line;
};

export const stateLabel = (state: string | undefined): string => {
  switch (state) {
    case 'input-streaming':
      return 'собирает аргументы';
    case 'input-available':
      return 'запускается';
    case 'approval-requested':
      return 'ждёт разрешения';
    case 'approval-responded':
      return 'разрешение получено';
    case 'output-available':
      return 'готово';
    case 'output-error':
      return 'ошибка';
    case 'output-denied':
      return 'отклонено';
    default:
      return 'вызов';
  }
};
