import { describe, expect, it } from 'vitest';
import type { UIMessage } from 'ai';
import {
  DIGEST_PREFIX,
  digestMessage,
  isDigest,
  renderTranscript,
  splitForCompaction,
} from './compact';

const message = (
  id: string,
  role: UIMessage['role'],
  parts: UIMessage['parts'],
): UIMessage => ({ id, role, parts });

const userText = (id: string, value: string) => message(id, 'user', [{ type: 'text', text: value }]);

describe('renderTranscript', () => {
  it('подписывает реплики ролью и склеивает части', () => {
    const transcript = renderTranscript([
      message('u1', 'user', [
        { type: 'text', text: 'Первый фрагмент' },
        { type: 'text', text: 'Второй фрагмент' },
      ]),
      message('a1', 'assistant', [{ type: 'text', text: 'Ответ модели' }]),
    ]);

    expect(transcript).toBe('пользователь: Первый фрагмент Второй фрагмент\n\nмодель: Ответ модели');
  });

  it('отмечает вызовы инструментов и пропускает пустые сообщения', () => {
    const transcript = renderTranscript([
      message('a1', 'assistant', [
        { type: 'tool-web_search', state: 'output-available' } as never,
        { type: 'reasoning', text: 'внутренние рассуждения' } as never,
      ]),
      message('a2', 'assistant', []),
    ]);

    expect(transcript).toBe('модель: [web_search: output-available]');
  });

  it('обрезает длинную историю, сохраняя начало и конец', () => {
    const long = Array.from({ length: 40 }, (_, index) =>
      message(`m${index}`, 'user', [{ type: 'text', text: `сообщение номер ${index} `.repeat(20) }]),
    );

    const transcript = renderTranscript(long, 2_000);

    expect(transcript.length).toBeLessThanOrEqual(2_100);
    expect(transcript).toContain('сообщение номер 0');
    expect(transcript).toContain('сообщение номер 39');
    expect(transcript).toContain('…');
  });
});

describe('splitForCompaction', () => {
  const conversation: UIMessage[] = [
    userText('u1', 'запрос один'),
    message('a1', 'assistant', [{ type: 'text', text: 'ответ один' }]),
    userText('u2', 'запрос два'),
    message('a2', 'assistant', [{ type: 'text', text: 'ответ два' }]),
    userText('u3', 'запрос три'),
    message('a3', 'assistant', [{ type: 'text', text: 'ответ три' }]),
    userText('u4', 'запрос четыре'),
    message('a4', 'assistant', [{ type: 'text', text: 'ответ четыре' }]),
  ];

  it('оставляет хвост и начинает его с реплики пользователя', () => {
    const { head, tail } = splitForCompaction(conversation, 3);

    expect(tail.map((item) => item.id)).toEqual(['u4', 'a4']);
    expect(tail[0].role).toBe('user');
    expect(head.map((item) => item.id)).toEqual(['u1', 'a1', 'u2', 'a2', 'u3', 'a3']);
  });

  it('режет по границе, когда она совпадает с репликой пользователя', () => {
    const { head, tail } = splitForCompaction(conversation, 2);

    expect(tail.map((item) => item.id)).toEqual(['u4', 'a4']);
    expect(head).toHaveLength(6);
  });

  it('не трогает короткую историю', () => {
    const { head, tail } = splitForCompaction(conversation.slice(0, 2), 6);

    expect(head).toEqual([]);
    expect(tail).toHaveLength(2);
  });

  it('не теряет последнее сообщение пользователя, если хвост начинается с ответа', () => {
    const { tail } = splitForCompaction(conversation, 1);

    expect(tail[0].role).toBe('user');
    expect(tail.map((item) => item.id)).toEqual(['u4', 'a4']);
  });
});

describe('digestMessage', () => {
  it('помечает сводку как системную и распознаётся обратно', () => {
    const digest = digestMessage('d1', 'Сводка разговора', 7);

    expect(digest.role).toBe('system');
    expect(isDigest(digest)).toBe(true);
    expect(digest.parts[0]).toMatchObject({ type: 'text' });
    expect(String((digest.parts[0] as { text: string }).text)).toContain(DIGEST_PREFIX);
    expect(String((digest.parts[0] as { text: string }).text)).toContain('7');
  });

  it('не принимает за сводку обычное системное сообщение', () => {
    expect(isDigest(message('s1', 'system', [{ type: 'text', text: 'Ты полезный помощник' }]))).toBe(false);
  });
});
