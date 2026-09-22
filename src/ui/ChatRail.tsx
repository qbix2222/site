import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChatSession } from '../core/types';
import { useChatStore } from '../store/chat-store';
import { useWorkspace } from '../store/workspace-store';
import { fileCount, plural, shortWhen, usd } from './format';

type Filter = 'all' | 'pinned' | 'archived';

const filters: Array<{ id: Filter; label: string }> = [
  { id: 'all', label: 'все' },
  { id: 'pinned', label: 'закреп.' },
  { id: 'archived', label: 'архив' },
];

function ChatRow({ session, active }: { session: ChatSession; active: boolean }) {
  const open = useChatStore((state) => state.open);
  const update = useChatStore((state) => state.update);
  const remove = useChatStore((state) => state.remove);
  const exportChat = useChatStore((state) => state.exportChat);
  const [menu, setMenu] = useState(false);
  const itemRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    if (!menu) return;

    const onDown = (event: MouseEvent) => {
      if (!itemRef.current?.contains(event.target as Node)) setMenu(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenu(false);
    };

    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  return (
    <li className="chat-item" ref={itemRef}>
      <div className="chat-row" data-active={active}>
        <button type="button" className="chat-open" onClick={() => void open(session.id)} aria-current={active}>
          {session.pinned && <span className="dot dot-busy" aria-label="закреплён" />}
          <span className="chat-title">{session.title}</span>
          <span className="chat-when">{shortWhen(session.updatedAt)}</span>
        </button>

        <button
          type="button"
          className="btn btn-quiet btn-icon chat-more"
          aria-label="Действия с разговором"
          aria-expanded={menu}
          aria-haspopup="menu"
          onClick={() => setMenu((value) => !value)}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <circle cx="3" cy="7" r="1.2" fill="currentColor" />
            <circle cx="7" cy="7" r="1.2" fill="currentColor" />
            <circle cx="11" cy="7" r="1.2" fill="currentColor" />
          </svg>
        </button>
      </div>

      {menu && (
        <div className="chat-menu" role="menu">
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenu(false);
              void update(session.id, { pinned: !session.pinned });
            }}
          >
            {session.pinned ? 'Открепить' : 'Закрепить'}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenu(false);
              void update(session.id, { archived: !session.archived });
            }}
          >
            {session.archived ? 'Вернуть из архива' : 'В архив'}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenu(false);
              void exportChat(session.id);
            }}
          >
            Выгрузить JSON
          </button>
          <button
            type="button"
            role="menuitem"
            className="danger"
            onClick={() => {
              setMenu(false);
              void remove(session.id);
            }}
          >
            Удалить
          </button>
        </div>
      )}
    </li>
  );
}

export function ChatRail() {
  const sessions = useChatStore((state) => state.sessions);
  const activeId = useChatStore((state) => state.activeId);
  const create = useChatStore((state) => state.create);
  const spend = useChatStore((state) => state.spendTotalUsd);
  const pending = useChatStore((state) => state.pending);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const nodes = useWorkspace((state) => state.nodes);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();

    return sessions
      .filter((session) =>
        filter === 'all' ? !session.archived : filter === 'pinned' ? session.pinned : session.archived,
      )
      .filter((session) => !needle || session.title.toLowerCase().includes(needle))
      .sort((left, right) => Number(right.pinned) - Number(left.pinned) || right.updatedAt - left.updatedAt);
  }, [sessions, filter, query]);

  return (
    <div className="rail-body">
      <div className="rail-head">
        <button type="button" className="btn btn-signal btn-wide" onClick={() => void create()}>
          Новый разговор
        </button>

        <input
          className="field field-mono"
          type="search"
          value={query}
          placeholder="поиск по названиям"
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Поиск разговоров"
        />

        <div className="segmented" role="group" aria-label="Фильтр списка">
          {filters.map((item) => (
            <button
              key={item.id}
              type="button"
              data-on={filter === item.id}
              aria-pressed={filter === item.id}
              onClick={() => setFilter(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="rail-scroll">
        {visible.length ? (
          <ul className="chat-list">
            {visible.map((session) => (
              <ChatRow key={session.id} session={session} active={session.id === activeId} />
            ))}
          </ul>
        ) : (
          <p className="rail-empty">
            {sessions.length ? 'Ничего не найдено.' : 'Разговоров пока нет — начните первый.'}
          </p>
        )}
      </div>

      <div className="rail-foot">
        <div className="row-between">
          <span className="label">
            {sessions.length} {plural(sessions.length, 'разговор', 'разговора', 'разговоров')} ·{' '}
            {fileCount(nodes.length)}
          </span>
          <span className="label" title="Потрачено по всем разговорам, по ценам моделей">
            {usd(spend)}
          </span>
        </div>

        {pending.length > 0 && (
          <p className="rail-pending">
            {pending.length} {plural(pending.length, 'сообщение ждёт', 'сообщения ждут', 'сообщений ждут')}{' '}
            отправки
          </p>
        )}
      </div>
    </div>
  );
}
