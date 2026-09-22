import { beforeEach, describe, expect, it } from 'vitest';
import type { UIMessage } from 'ai';
import {
  createChat,
  deleteChat,
  emptyMessageMeta,
  exportChatSnapshot,
  getFile,
  listChats,
  listFiles,
  listMessages,
  listTerminal,
  listVersions,
  nextSequence,
  putChat,
  putFile,
  putMessages,
  readSettings,
  writeSettings,
  appendTerminal,
  clearEverything,
  DEFAULT_SETTINGS,
} from './repository';
import { database, MAX_FILE_VERSIONS } from './db';
import { InvalidPathError } from '../workspace/paths';

function storedMessage(chatId: string, seq: number, text: string) {
  const message: UIMessage = {
    id: `m-${chatId}-${seq}`,
    role: seq % 2 === 0 ? 'user' : 'assistant',
    parts: [{ type: 'text', text }],
  };
  return {
    id: message.id,
    chatId,
    seq,
    role: message.role,
    parts: message.parts,
    meta: emptyMessageMeta(),
    createdAt: Date.now() + seq,
  };
}

beforeEach(async () => {
  await clearEverything();
});

describe('chats', () => {
  it('создаёт разговор с настройками по умолчанию', async () => {
    const chat = createChat({ title: 'Первый' });
    await putChat(chat);

    const [stored] = await listChats();
    expect(stored.title).toBe('Первый');
    expect(stored.settings.approvalRequired).toBe(true);
    expect(stored.tokenBudgetRatio).toBe(0.9);
  });

  it('сортирует закреплённые разговоры выше', async () => {
    const first = await putChat(createChat({ title: 'Обычный' }));
    const second = await putChat(createChat({ title: 'Закреплённый', pinned: true }));

    const chats = await listChats();
    expect(chats.map((chat) => chat.id)).toEqual([second.id, first.id]);
  });

  it('удаляет разговор вместе с сообщениями и файлами', async () => {
    const chat = await putChat(createChat({ title: 'Временный' }));
    await putMessages([storedMessage(chat.id, 0, 'вопрос')]);
    await putFile(chat.id, 'notes.md', { text: 'черновик' }, 'user');
    await appendTerminal(chat.id, [{ stream: 'out', text: 'привет' }]);

    expect(await listMessages(chat.id)).toHaveLength(1);
    expect(await listFiles(chat.id)).toHaveLength(1);
    expect(await listTerminal(chat.id)).toHaveLength(1);

    await deleteChat(chat.id);

    expect(await listChats()).toHaveLength(0);
    expect(await listMessages(chat.id)).toHaveLength(0);
    expect(await listFiles(chat.id)).toHaveLength(0);
    expect(await listTerminal(chat.id)).toHaveLength(0);
  });
});

describe('messages', () => {
  it('нумерует сообщения по порядку и возвращает их в том же порядке', async () => {
    const chat = await putChat(createChat());
    expect(await nextSequence(chat.id)).toBe(0);

    await putMessages([
      storedMessage(chat.id, 0, 'первый'),
      storedMessage(chat.id, 1, 'второй'),
    ]);

    expect(await nextSequence(chat.id)).toBe(2);

    const rows = await listMessages(chat.id);
    expect(rows.map((row) => row.seq)).toEqual([0, 1]);
    expect(rows[1].parts).toEqual([{ type: 'text', text: 'второй' }]);
  });
});

describe('workspace', () => {
  it('сохраняет текст файла и определяет его тип', async () => {
    const chat = await putChat(createChat());
    const node = await putFile(chat.id, 'src/app.ts', { text: 'export const a = 1;' }, 'user');

    expect(node.mediaType).toBe('text/plain');
    expect(node.size).toBeGreaterThan(0);
    expect(node.origin).toBe('user');

    const stored = await getFile(chat.id, 'src/app.ts');
    expect(stored?.text).toBe('export const a = 1;');
  });

  it('отклоняет выход за пределы рабочей папки', async () => {
    const chat = await putChat(createChat());
    await expect(putFile(chat.id, '../secret.txt', { text: 'x' }, 'agent')).rejects.toBeInstanceOf(
      InvalidPathError,
    );
  });

  it('сохраняет предыдущую версию при перезаписи', async () => {
    const chat = await putChat(createChat());
    const first = await putFile(chat.id, 'notes.md', { text: 'версия 1' }, 'user');
    await putFile(chat.id, 'notes.md', { text: 'версия 2' }, 'agent');

    const versions = await listVersions(first.id);
    expect(versions).toHaveLength(1);
    expect(versions[0].text).toBe('версия 1');
    expect(versions[0].origin).toBe('user');

    const current = await getFile(chat.id, 'notes.md');
    expect(current?.text).toBe('версия 2');
    expect(current?.id).toBe(first.id);
  });

  it('не плодит версию, когда содержимое не изменилось', async () => {
    const chat = await putChat(createChat());
    const node = await putFile(chat.id, 'same.md', { text: 'текст' }, 'user');
    await putFile(chat.id, 'same.md', { text: 'текст' }, 'agent');
    expect(await listVersions(node.id)).toHaveLength(0);
  });

  it('ограничивает глубину истории версий', async () => {
    const chat = await putChat(createChat());
    const node = await putFile(chat.id, 'log.md', { text: 'v0' }, 'user');

    for (let index = 1; index <= MAX_FILE_VERSIONS + 6; index += 1) {
      await putFile(chat.id, 'log.md', { text: `v${index}` }, 'agent');
    }

    const versions = await listVersions(node.id);
    expect(versions.length).toBeLessThanOrEqual(MAX_FILE_VERSIONS);
    expect(versions[0].text).not.toBe('v0');
  });
});

describe('settings and export', () => {
  it('хранит настройки и дополняет их значениями по умолчанию', async () => {
    const stored = await readSettings();
    expect(stored.theme).toBe(DEFAULT_SETTINGS.theme);

    await writeSettings({ ...stored, theme: 'dark', maxRetries: 5 });
    const updated = await readSettings();
    expect(updated.theme).toBe('dark');
    expect(updated.maxRetries).toBe(5);
    expect(updated.sendOnEnter).toBe(DEFAULT_SETTINGS.sendOnEnter);
  });

  it('собирает полный снимок разговора для переноса', async () => {
    const chat = await putChat(createChat({ title: 'Перенос' }));
    await putMessages([storedMessage(chat.id, 0, 'вопрос')]);
    await putFile(chat.id, 'data.json', { text: '{}' }, 'user');

    const snapshot = await exportChatSnapshot(chat.id);
    expect(snapshot?.chat.title).toBe('Перенос');
    expect(snapshot?.messages).toHaveLength(1);
    expect(snapshot?.files.map((file) => file.path)).toEqual(['data.json']);

    expect(await exportChatSnapshot('missing')).toBeNull();
  });

  it('переживает повторное открытие базы', async () => {
    const chat = await putChat(createChat({ title: 'Стойкий' }));
    const db = await database();
    expect(db.name).toBe('pult');
    expect((await listChats()).some((row) => row.id === chat.id)).toBe(true);
  });
});
