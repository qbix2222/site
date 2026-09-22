import { describe, expect, it } from 'vitest';
import type { UIMessage } from 'ai';
import { describeApprovalInput, findPendingApproval } from './approval';

const textMessage = (id: string, text: string, role: UIMessage['role'] = 'assistant'): UIMessage => ({
  id,
  role,
  parts: [{ type: 'text', text }],
});

const approvalMessage = (id: string, part: Record<string, unknown>): UIMessage => ({
  id,
  role: 'assistant',
  parts: [part as never],
});

describe('findPendingApproval', () => {
  it('находит запрос разрешения в последнем ответе', () => {
    const pending = findPendingApproval([
      textMessage('m1', 'Запущу сборку'),
      approvalMessage('m2', {
        type: 'tool-run_command',
        toolCallId: 'call-1',
        state: 'approval-requested',
        input: { command: 'npm run build' },
        approval: { id: 'apr-1', requestReason: 'команда меняет файловую систему' },
      }),
    ]);

    expect(pending).toEqual({
      toolCallId: 'call-1',
      approvalId: 'apr-1',
      toolName: 'run_command',
      input: { command: 'npm run build' },
      reason: 'команда меняет файловую систему',
    });
  });

  it('не путает ожидание с уже выполненным инструментом', () => {
    expect(
      findPendingApproval([
        approvalMessage('m1', {
          type: 'tool-read_file',
          toolCallId: 'call-2',
          state: 'output-available',
          input: { path: 'src/index.ts' },
          output: 'export {}',
        }),
      ]),
    ).toBeNull();
  });

  it('не ищет разрешение в сообщениях пользователя', () => {
    expect(
      findPendingApproval([
        approvalMessage('m1', {
          type: 'tool-write_file',
          toolCallId: 'call-3',
          state: 'approval-requested',
          approval: { id: 'apr-3' },
        }),
        textMessage('m2', 'продолжай', 'user'),
      ]),
    ).toBeNull();
  });

  it('берёт самый свежий запрос, если их несколько', () => {
    const pending = findPendingApproval([
      approvalMessage('m1', {
        type: 'tool-delete_file',
        toolCallId: 'call-old',
        state: 'approval-requested',
        approval: { id: 'apr-old' },
      }),
      approvalMessage('m2', {
        type: 'tool-run_javascript',
        toolCallId: 'call-new',
        state: 'approval-requested',
        approval: { id: 'apr-new' },
      }),
    ]);

    expect(pending?.toolCallId).toBe('call-new');
    expect(pending?.toolName).toBe('run_javascript');
    expect(pending?.reason).toBeNull();
  });

  it('молчит на пустой истории', () => {
    expect(findPendingApproval([])).toBeNull();
  });

  it('не падает на неполной части инструмента', () => {
    expect(
      findPendingApproval([
        approvalMessage('m1', { type: 'tool-run_command', state: 'approval-requested' }),
      ]),
    ).toBeNull();
  });
});

describe('describeApprovalInput', () => {
  it('показывает аргументы команды как JSON', () => {
    expect(describeApprovalInput({ command: 'rm -rf build', cwd: 'app' })).toContain('rm -rf build');
  });

  it('обрезает длинный код, чтобы карточка не разъезжалась', () => {
    const described = describeApprovalInput({ code: 'x'.repeat(5_000) });
    expect(described.length).toBeLessThan(900);
    expect(described).toContain('…');
  });

  it('переживает пустоту и циклические объекты', () => {
    expect(describeApprovalInput(null)).toBe('');
    expect(describeApprovalInput(undefined)).toBe('');

    const cyclic: Record<string, unknown> = { name: 'узел' };
    cyclic.self = cyclic;
    expect(describeApprovalInput(cyclic)).toBe('[object Object]');
  });
});
