import { useEffect, useMemo, useRef, useState } from 'react';
import { VERCEL_DEPLOY_URL } from '../core/deploy';
import { useAccounts } from '../store/accounts-store';
import { useChatStore } from '../store/chat-store';
import { useSettings } from '../store/settings-store';

export interface PaletteActions {
  onClose(): void;
  onOpenSettings(): void;
  onOpenProviders(): void;
  onOpenTurn(): void;
  onToggleWork(): void;
  onOpenRail(): void;
}

interface Item {
  id: string;
  group: string;
  label: string;
  hint?: string;
  run(): void;
}

export function Palette({
  onClose,
  onOpenSettings,
  onOpenProviders,
  onOpenTurn,
  onToggleWork,
  onOpenRail,
}: PaletteActions) {
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);

  const sessions = useChatStore((state) => state.sessions);
  const activeId = useChatStore((state) => state.activeId);
  const create = useChatStore((state) => state.create);
  const open = useChatStore((state) => state.open);
  const update = useChatStore((state) => state.update);
  const compact = useChatStore((state) => state.compact);
  const exportChat = useChatStore((state) => state.exportChat);
  const exportAll = useChatStore((state) => state.exportAll);
  const models = useAccounts((state) => state.models);
  const theme = useSettings((state) => state.theme);
  const patch = useSettings((state) => state.patch);

  useEffect(() => {
    input.current?.focus();

    const onDown = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) onClose();
    };

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);

    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const items = useMemo<Item[]>(() => {
    const session = sessions.find((item) => item.id === activeId) ?? null;

    const commands: Item[] = [
      {
        id: 'new-chat',
        group: 'команды',
        label: 'Новый разговор',
        hint: 'свои файлы, своя модель, свой контекст',
        run: () => void create(),
      },
      { id: 'turn', group: 'команды', label: 'Параметры разговора', hint: 'роль, указания, расход, инструменты', run: onOpenTurn },
      { id: 'providers', group: 'команды', label: 'Провайдеры и модели', hint: 'ключи, opencode.json', run: onOpenProviders },
      { id: 'settings', group: 'команды', label: 'Настройки', hint: 'поиск, бэкенд, деплой, данные', run: onOpenSettings },
      {
        id: 'compact',
        group: 'команды',
        label: 'Сжать историю',
        hint: 'освободить контекст сводкой',
        run: () => void compact(),
      },
      {
        id: 'theme',
        group: 'команды',
        label: theme === 'dark' ? 'Светлая тема' : 'Тёмная тема',
        run: () => void patch({ theme: theme === 'dark' ? 'light' : 'dark' }),
      },
      { id: 'work', group: 'команды', label: 'Рабочая панель', hint: 'файлы разговора и вывод команд', run: onToggleWork },
      { id: 'rail', group: 'команды', label: 'Список разговоров', run: onOpenRail },
      {
        id: 'export-chat',
        group: 'команды',
        label: 'Выгрузить разговор',
        hint: 'JSON со сообщениями и файлами',
        run: () => session && void exportChat(session.id),
      },
      { id: 'export-all', group: 'команды', label: 'Резервная копия всего', run: () => void exportAll() },
      {
        id: 'deploy',
        group: 'команды',
        label: 'Развернуть на Vercel',
        hint: 'открывает внешнюю страницу',
        run: () => window.open(VERCEL_DEPLOY_URL, '_blank', 'noreferrer'),
      },
    ];

    const chats: Item[] = sessions
      .filter((item) => !item.archived)
      .slice(0, 40)
      .map((item) => ({
        id: `chat-${item.id}`,
        group: 'разговоры',
        label: item.title,
        hint: item.id === activeId ? 'открыт' : undefined,
        run: () => void open(item.id),
      }));

    const modelItems: Item[] = session
      ? models.slice(0, 60).map((model) => ({
          id: `model-${model.key}`,
          group: 'модели',
          label: model.name,
          hint: session.modelKey === model.key ? 'модель разговора' : model.id,
          run: () => void update(session.id, { modelKey: model.key }),
        }))
      : [];

    return [...commands, ...chats, ...modelItems];
  }, [
    sessions,
    activeId,
    models,
    theme,
    create,
    open,
    update,
    compact,
    exportChat,
    exportAll,
    patch,
    onClose,
    onOpenProviders,
    onOpenSettings,
    onOpenTurn,
    onOpenRail,
    onToggleWork,
  ]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return items;

    return items.filter(
      (item) => item.label.toLowerCase().includes(needle) || item.group.includes(needle),
    );
  }, [items, query]);

  const groups = useMemo(() => {
    const order: string[] = [];
    const byGroup = new Map<string, Item[]>();

    for (const item of filtered) {
      if (!byGroup.has(item.group)) {
        byGroup.set(item.group, []);
        order.push(item.group);
      }
      byGroup.get(item.group)?.push(item);
    }

    return order.map((group) => ({ group, items: byGroup.get(group) ?? [] }));
  }, [filtered]);

  useEffect(() => {
    setCursor((value) => Math.min(value, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  function runAt(index: number): void {
    const item = filtered[index];
    if (!item) return;

    onClose();
    item.run();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Escape') {
      onClose();
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setCursor((value) => (value + 1) % Math.max(1, filtered.length));
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setCursor((value) => (value - 1 + filtered.length) % Math.max(1, filtered.length));
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      runAt(cursor);
    }
  }

  let position = -1;

  return (
    <>
      <button type="button" className="scrim" aria-label="Закрыть поиск" onClick={onClose} tabIndex={-1} />

      <div className="palette" role="dialog" aria-modal="true" aria-label="Команды и переходы" ref={box}>
        <input
          ref={input}
          className="palette-input"
          value={query}
          placeholder="команда, разговор или модель"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
          aria-label="Поиск команд"
        />

        <div className="palette-list">
          {groups.map(({ group, items: groupItems }) => (
            <section key={group}>
              <p className="palette-group">{group}</p>

              {groupItems.map((item) => {
                position += 1;
                const index = position;

                return (
                  <button
                    key={item.id}
                    type="button"
                    className="palette-item"
                    data-on={index === cursor}
                    onMouseEnter={() => setCursor(index)}
                    onClick={() => runAt(index)}
                  >
                    <span className="palette-label">{item.label}</span>
                    {item.hint && <span className="label palette-hint">{item.hint}</span>}
                  </button>
                );
              })}
            </section>
          ))}

          {!filtered.length && <p className="rail-empty">Ничего не нашлось</p>}
        </div>

        <p className="palette-foot label">
          <kbd className="kbd">↑</kbd>
          <kbd className="kbd">↓</kbd> выбор · <kbd className="kbd">enter</kbd> выполнить ·{' '}
          <kbd className="kbd">esc</kbd> закрыть
        </p>
      </div>
    </>
  );
}
