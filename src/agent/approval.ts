import type { UIMessage } from 'ai';

export interface PendingApproval {
  toolCallId: string;
  approvalId: string;
  toolName: string;
  input: unknown;
  reason: string | null;
}

interface ApprovalPart {
  type?: string;
  state?: string;
  toolCallId?: string;
  input?: unknown;
  approval?: { id: string; requestReason?: string };
}

export function findPendingApproval(messages: UIMessage[]): PendingApproval | null {
  const last = messages[messages.length - 1];
  if (!last || last.role !== 'assistant') return null;

  for (const part of last.parts) {
    const record = part as ApprovalPart;
    if (record.state !== 'approval-requested' || !record.approval || !record.toolCallId) continue;

    return {
      toolCallId: record.toolCallId,
      approvalId: record.approval.id,
      toolName: (record.type ?? 'tool-unknown').replace(/^tool-/, ''),
      input: record.input,
      reason: record.approval.requestReason ?? null,
    };
  }

  return null;
}

export function describeApprovalInput(input: unknown): string {
  if (input === null || input === undefined) return '';

  if (typeof input === 'string') return input.length > 400 ? `${input.slice(0, 400)}…` : input;

  try {
    const json = JSON.stringify(input, null, 2);
    return json.length > 800 ? `${json.slice(0, 800)}\n…` : json;
  } catch {
    return String(input);
  }
}
