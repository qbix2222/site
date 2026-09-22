import { generateText, isTextUIPart, isToolUIPart } from 'ai';
import type { LanguageModel, UIMessage } from 'ai';

export const DIGEST_PREFIX = 'Сжатая история разговора';

export const COMPACT_INSTRUCTIONS = `Ты сжимаешь историю разговора, чтобы освободить место в контексте.
Сделай плотную сводку по разделам, без воды и без пересказа реплик дословно:

ЗАДАЧА — что пользователь хочет получить в итоге.
РЕШЕНИЯ — какие подходы выбраны и почему, что отвергнуто.
ФАКТЫ — конкретные данные: пути файлов, команды, версии, числа, ссылки, ограничения.
СОСТОЯНИЕ — что уже сделано, какие файлы созданы или изменены, что работает.
ОТКРЫТОЕ — что осталось сделать, какие вопросы без ответа, какие ошибки не исправлены.

Пиши на языке разговора. Не выдумывай того, чего в истории нет. Укладывайся в 400 слов.`;

const roleLabel = (role: UIMessage['role']): string =>
  role === 'user' ? 'пользователь' : role === 'assistant' ? 'модель' : 'система';

export function renderTranscript(messages: UIMessage[], maxChars = 24_000): string {
  const lines: string[] = [];

  for (const message of messages) {
    const chunks: string[] = [];

    for (const part of message.parts) {
      if (isTextUIPart(part) && part.text.trim()) {
        chunks.push(part.text.trim());
        continue;
      }

      if (isToolUIPart(part)) {
        const tool = part as { type?: string; state?: string };
        chunks.push(`[${(tool.type ?? 'tool').replace(/^tool-/, '')}: ${tool.state ?? 'вызов'}]`);
      }
    }

    if (!chunks.length) continue;

    lines.push(`${roleLabel(message.role)}: ${chunks.join(' ')}`);
  }

  const transcript = lines.join('\n\n');

  if (transcript.length <= maxChars) return transcript;

  return `${transcript.slice(0, maxChars / 3)}\n…\n${transcript.slice(-((maxChars * 2) / 3))}`;
}

export interface CompactionSplit {
  head: UIMessage[];
  tail: UIMessage[];
}

export function splitForCompaction(messages: UIMessage[], keepTail: number): CompactionSplit {
  if (messages.length <= keepTail) return { head: [], tail: messages };

  let boundary = messages.length - keepTail;

  while (boundary < messages.length && messages[boundary].role !== 'user') boundary += 1;

  if (boundary >= messages.length) {
    const lastUser = messages.map((message) => message.role).lastIndexOf('user');
    boundary = lastUser > 0 ? lastUser : messages.length - 1;
  }

  if (boundary <= 0) return { head: [], tail: messages };

  return { head: messages.slice(0, boundary), tail: messages.slice(boundary) };
}

export interface DigestResult {
  digest: string;
  inputChars: number;
  outputTokens: number;
  durationMs: number;
}

export async function summarizeHistory(
  messages: UIMessage[],
  model: LanguageModel,
  maxOutputTokens = 700,
): Promise<DigestResult> {
  const startedAt = Date.now();
  const transcript = renderTranscript(messages);

  if (!transcript.trim()) {
    return { digest: '', inputChars: 0, outputTokens: 0, durationMs: 0 };
  }

  const result = await generateText({
    model,
    instructions: COMPACT_INSTRUCTIONS,
    prompt: transcript,
    maxOutputTokens,
    temperature: 0.2,
    abortSignal: undefined,
  });

  return {
    digest: result.text.trim(),
    inputChars: transcript.length,
    outputTokens: result.usage?.outputTokens ?? 0,
    durationMs: Date.now() - startedAt,
  };
}

export const digestMessage = (id: string, digest: string, droppedCount: number): UIMessage => ({
  id,
  role: 'system',
  parts: [
    {
      type: 'text',
      text: `${DIGEST_PREFIX} (свёрнуто сообщений: ${droppedCount}).\n\n${digest}`,
    },
  ],
});

export const isDigest = (message: UIMessage): boolean =>
  message.role === 'system' &&
  message.parts.some((part) => isTextUIPart(part) && part.text.startsWith(DIGEST_PREFIX));
