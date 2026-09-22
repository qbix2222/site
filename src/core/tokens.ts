import {
  isDataUIPart,
  isFileUIPart,
  isReasoningUIPart,
  isTextUIPart,
  isToolUIPart,
  type UIMessage,
} from 'ai';
import type { Attachment, ModelCost, UsageRecord } from './types';

export const CHARS_PER_TOKEN = 3.6;

export const estimateTextTokens = (text: string): number =>
  text.length ? Math.ceil(text.length / CHARS_PER_TOKEN) : 0;

export function estimateImageTokens(width: number, height: number): number {
  if (!width || !height) return 1120;
  const limit = 2048;
  let scaledWidth = width;
  let scaledHeight = height;

  if (scaledWidth > limit || scaledHeight > limit) {
    const ratio = Math.min(limit / scaledWidth, limit / scaledHeight);
    scaledWidth = Math.round(scaledWidth * ratio);
    scaledHeight = Math.round(scaledHeight * ratio);
  }

  const shortest = Math.min(scaledWidth, scaledHeight);
  if (shortest > 768) {
    const ratio = 768 / shortest;
    scaledWidth = Math.round(scaledWidth * ratio);
    scaledHeight = Math.round(scaledHeight * ratio);
  }

  const tiles = Math.ceil(scaledWidth / 512) * Math.ceil(scaledHeight / 512);
  return 85 + tiles * 170;
}

const ATTACHMENT_TOKENS: Record<Attachment['kind'], number> = {
  image: 1120,
  document: 1500,
  audio: 800,
  video: 1600,
  other: 256,
};

export const estimateAttachmentTokens = (attachment: Attachment): number =>
  ATTACHMENT_TOKENS[attachment.kind] ?? 256;

export function estimatePartsTokens(parts: UIMessage['parts']): number {
  let total = 0;

  for (const part of parts) {
    if (isTextUIPart(part) || isReasoningUIPart(part)) {
      total += estimateTextTokens(part.text);
      continue;
    }
    if (isFileUIPart(part)) {
      total += part.mediaType.startsWith('image/')
        ? ATTACHMENT_TOKENS.image
        : ATTACHMENT_TOKENS.document;
      continue;
    }
    if (isToolUIPart(part)) {
      total += estimateTextTokens(JSON.stringify(part.input ?? null));
      const output: unknown = part.output;
      if (typeof output === 'string') total += estimateTextTokens(output);
      else if (output) total += estimateTextTokens(JSON.stringify(output));
      continue;
    }
    if (isDataUIPart(part)) {
      total += estimateTextTokens(JSON.stringify(part.data ?? null));
    }
  }

  return total;
}

export const MESSAGE_OVERHEAD_TOKENS = 4;

export const estimateMessageTokens = (message: UIMessage): number =>
  estimatePartsTokens(message.parts) + MESSAGE_OVERHEAD_TOKENS;

export const estimateToolSchemaTokens = (toolCount: number): number => toolCount * 120;

export interface FitBudget {
  contextWindow: number;
  ratio: number;
  instructionsTokens: number;
  toolsTokens: number;
  reserveOutput: number;
}

export interface FitPlan {
  start: number;
  dropped: number;
  budget: number;
  estimated: number;
  overflow: boolean;
}

export function budgetFor(budget: FitBudget): number {
  if (budget.contextWindow <= 0) return Number.POSITIVE_INFINITY;
  const usable = budget.contextWindow * budget.ratio;
  return Math.max(
    0,
    Math.floor(usable - budget.instructionsTokens - budget.toolsTokens - budget.reserveOutput),
  );
}

export function fitContext(messages: UIMessage[], budget: FitBudget): FitPlan {
  const limit = budgetFor(budget);

  if (messages.length === 0) {
    return { start: 0, dropped: 0, budget: limit, estimated: 0, overflow: false };
  }

  const sizes = messages.map(estimateMessageTokens);
  const total = sizes.reduce((sum, size) => sum + size, 0);

  if (total <= limit) {
    return { start: 0, dropped: 0, budget: limit, estimated: total, overflow: false };
  }

  let start = messages.length;
  let running = 0;

  while (start > 0) {
    const candidate = start - 1;
    if (running + sizes[candidate] > limit) break;
    running += sizes[candidate];
    start = candidate;
  }

  let boundary = start;
  while (boundary < messages.length && messages[boundary].role !== 'user') {
    boundary += 1;
  }

  if (boundary < messages.length) {
    const estimated = sizes.slice(boundary).reduce((sum, size) => sum + size, 0);
    return {
      start: boundary,
      dropped: boundary,
      budget: limit,
      estimated,
      overflow: estimated > limit,
    };
  }

  const lastUser = messages.map((message) => message.role).lastIndexOf('user');
  if (lastUser < 0) {
    return {
      start: messages.length,
      dropped: messages.length,
      budget: limit,
      estimated: 0,
      overflow: true,
    };
  }

  const tail = sizes.slice(lastUser).reduce((sum, size) => sum + size, 0);
  return {
    start: lastUser,
    dropped: lastUser,
    budget: limit,
    estimated: tail,
    overflow: tail > limit,
  };
}

export function estimateUsageCost(usage: UsageRecord, cost: ModelCost): number {
  const perToken = (rate: number) => rate / 1_000_000;
  const billableInput = Math.max(0, usage.inputTokens - usage.cachedInputTokens);

  return (
    billableInput * perToken(cost.input) +
    usage.cachedInputTokens * perToken(cost.cacheRead) +
    usage.outputTokens * perToken(cost.output)
  );
}

export function emptyUsage(): UsageRecord {
  return {
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cachedInputTokens: 0,
    costUsd: 0,
    durationMs: 0,
  };
}
