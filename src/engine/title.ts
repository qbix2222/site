import { generateText, isTextUIPart } from 'ai';
import type { LanguageModel, UIMessage } from 'ai';

const TITLE_INSTRUCTIONS = `Придумай название разговора: от двух до пяти слов, по существу первого запроса.
Без кавычек, без точки в конце, без слов «разговор», «чат», «запрос». Первый символ заглавный.
Отвечай на языке запроса. Ничего кроме названия.`;

export function cleanTitle(raw: string): string {
  const line = raw
    .split('\n')[0]
    .replace(/^["'«“”\s]+|["'»“”.\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!line) return '';

  const capped = line.length > 48 ? `${line.slice(0, 48).replace(/\s\S*$/, '')}…` : line;

  return capped.charAt(0).toUpperCase() + capped.slice(1);
}

export function titlePrompt(messages: UIMessage[], maxChars = 1_600): string {
  const firstUser = messages.find((message) => message.role === 'user');
  if (!firstUser) return '';

  const text = firstUser.parts
    .filter(isTextUIPart)
    .map((part) => part.text)
    .join('\n')
    .trim();

  if (!text) return '';

  const answer = messages
    .filter((message) => message.role === 'assistant')
    .flatMap((message) => message.parts.filter(isTextUIPart).map((part) => part.text))
    .join('\n')
    .trim();

  const head = text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;

  return answer ? `Запрос:\n${head}\n\nНачало ответа:\n${answer.slice(0, maxChars)}` : `Запрос:\n${head}`;
}

export async function suggestTitle(
  messages: UIMessage[],
  model: LanguageModel,
): Promise<string | null> {
  const prompt = titlePrompt(messages);
  if (!prompt) return null;

  try {
    const result = await generateText({
      model,
      instructions: TITLE_INSTRUCTIONS,
      prompt,
      maxOutputTokens: 40,
      temperature: 0.3,
    });

    const title = cleanTitle(result.text);

    return title || null;
  } catch {
    return null;
  }
}
