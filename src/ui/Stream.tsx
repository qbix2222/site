import { useEffect, useRef } from 'react';
import { useChatStore } from '../store/chat-store';
import { useWorkspace } from '../store/workspace-store';
import { Message } from './Message';
import { fileCount } from './format';

const starters: Array<{ title: string; prompt: string }> = [
  {
    title: 'Разобрать код',
    prompt: 'Положи в рабочую папку файл с кодом и разбери его: что делает, где хрупко, что переписать первым.',
  },
  {
    title: 'Собрать страницу',
    prompt: 'Собери одностраничный сайт по моему описанию, сохрани файлы в рабочую папку и запусти сборку.',
  },
  {
    title: 'Посчитать и показать',
    prompt: 'Посчитай то, что я опишу, покажи расчёт кодом и сохрани результат таблицей в рабочую папку.',
  },
  {
    title: 'Вычитать текст',
    prompt: 'Вычитай мой текст: убери канцелярит и повторы, покажи правки и объясни каждую.',
  },
];

function EmptyState({ onPick }: { onPick(text: string): void }) {
  const nodes = useWorkspace((state) => state.nodes);

  return (
    <div className="empty">
      <h2 className="empty-title">
        Разговор с рабочей папкой,
        <br />
        моделью и песочницей
      </h2>

      <p className="empty-lede">
        У каждого разговора своё окружение: свои файлы, своя модель, свои настройки инструментов. Модель
        умеет читать и править эти файлы, искать по ним и исполнять код — команды, меняющие окружение,
        проходят через ваше разрешение.
      </p>

      <div className="starters">
        <p className="label">с чего начать</p>
        <ul>
          {starters.map((item) => (
            <li key={item.title}>
              <button type="button" onClick={() => onPick(item.prompt)}>
                <span className="starter-title">{item.title}</span>
                <span className="starter-prompt">{item.prompt}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      <p className="label">
        {nodes.length ? `${fileCount(nodes.length)} в рабочей папке` : 'рабочая папка пуста'}
      </p>
    </div>
  );
}

export function Stream({ onPick }: { onPick(text: string): void }) {
  const messages = useChatStore((state) => state.messages);
  const status = useChatStore((state) => state.status);
  const engine = useChatStore((state) => state.engine);
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  useEffect(() => {
    const node = scroller.current;
    if (!node) return;

    const onScroll = () => {
      pinned.current = node.scrollHeight - node.scrollTop - node.clientHeight < 90;
    };

    node.addEventListener('scroll', onScroll, { passive: true });
    return () => node.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    const node = scroller.current;
    if (node && pinned.current) node.scrollTop = node.scrollHeight;
  }, [messages, status.phase]);

  const busy = status.phase === 'streaming' || status.phase === 'preparing' || status.phase === 'retrying';
  const silent = busy && !messages.some((message) => message.role === 'assistant');

  return (
    <div className="stream" ref={scroller}>
      <div className="stream-inner">
        {messages.length === 0 && engine ? <EmptyState onPick={onPick} /> : null}

        {messages.map((message, index) => (
          <Message key={message.id} message={message} last={index === messages.length - 1} />
        ))}

        {busy && (
          <div className="status-line" aria-live="polite">
            <span className="dot dot-busy" />
            <span className="label">{status.note || 'идёт ответ'}</span>
            {status.attempt > 1 && <span className="chip chip-signal">попытка {status.attempt}</span>}
          </div>
        )}

        {silent && <div className="streaming-caret caret" aria-hidden="true" />}
      </div>
    </div>
  );
}
