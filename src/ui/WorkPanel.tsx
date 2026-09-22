import { useEffect, useMemo, useRef, useState } from 'react';
import type { StoredWorkspaceNode } from '../store/db';
import { useChatStore } from '../store/chat-store';
import { useWorkspace } from '../store/workspace-store';
import { saveSource } from '../workspace/download';
import { isTextual } from '../workspace/paths';
import { formatBytes } from '../workspace/summary';
import { fullWhen, plural } from './format';

type Tab = 'files' | 'terminal';

const originLabel: Record<StoredWorkspaceNode['origin'], string> = {
  user: 'добавлен вами',
  agent: 'создан моделью',
  runtime: 'из песочницы',
};

function Preview({ node }: { node: StoredWorkspaceNode }) {
  const contentOf = useWorkspace((state) => state.contentOf);
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    if (node.dataUrl) {
      setText(null);
      return () => {
        alive = false;
      };
    }

    void contentOf(node.path).then((value) => {
      if (alive) setText(value);
    });

    return () => {
      alive = false;
    };
  }, [node.path, node.dataUrl, node.updatedAt, contentOf]);

  if (node.dataUrl && node.mediaType?.startsWith('image/')) {
    return (
      <div className="file-preview">
        <img src={node.dataUrl} alt={node.name} />
      </div>
    );
  }

  if (node.dataUrl) {
    return (
      <div className="file-preview">
        <p className="setting-copy">
          Бинарный файл, {formatBytes(node.size)}. В браузере доступен на скачивание и для отправки
          модели как вложение.
        </p>
      </div>
    );
  }

  return (
    <div className="file-preview">
      {isTextual(node.path, node.mediaType) ? (
        <pre className="file-text">
          <code>{text ?? '…'}</code>
        </pre>
      ) : (
        <p className="setting-copy">Файл без текстового содержимого.</p>
      )}
    </div>
  );
}

function FileList() {
  const chatId = useChatStore((state) => state.activeId);
  const nodes = useWorkspace((state) => state.nodes);
  const selected = useWorkspace((state) => state.selectedPath);
  const open = useWorkspace((state) => state.open);
  const upload = useWorkspace((state) => state.upload);
  const remove = useWorkspace((state) => state.remove);
  const rename = useWorkspace((state) => state.rename);
  const write = useWorkspace((state) => state.write);
  const contentOf = useWorkspace((state) => state.contentOf);
  const picker = useRef<HTMLInputElement>(null);
  const [draftName, setDraftName] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameTo, setRenameTo] = useState('');

  const current = useMemo(
    () => nodes.find((node) => node.path === selected) ?? null,
    [nodes, selected],
  );

  if (!chatId) return <p className="rail-empty">Рабочая папка появляется у открытого разговора.</p>;

  async function addFile(): Promise<void> {
    const name = draftName.trim();
    if (!name || !chatId) return;

    await write(chatId, name, '', 'user');
    setDraftName('');
    open(name);
  }

  return (
    <div className="work-body">
      <div className="work-actions">
        <input
          ref={picker}
          type="file"
          multiple
          className="sr-only"
          onChange={(event) => {
            const files = [...(event.target.files ?? [])];
            if (files.length) void upload(chatId, files);
            event.target.value = '';
          }}
        />

        <button type="button" className="btn btn-quiet" onClick={() => picker.current?.click()}>
          загрузить
        </button>

        <input
          className="field field-mono work-new"
          value={draftName}
          placeholder="новый файл: notes.md"
          onChange={(event) => setDraftName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void addFile();
            if (event.key === 'Escape') setDraftName('');
          }}
          aria-label="Имя нового файла"
        />

        <button type="button" className="btn btn-quiet" onClick={() => void addFile()} disabled={!draftName.trim()}>
          создать
        </button>
      </div>

      {nodes.length === 0 && (
        <p className="rail-empty">
          Папка пуста. Загрузите файлы или попросите модель записать свои — она пишет прямо сюда.
        </p>
      )}

      <div className="file-tree">
        {nodes.map((node) => (
          <div className="file-line" key={node.id}>
            {renaming === node.path ? (
              <input
                className="field field-mono"
                value={renameTo}
                autoFocus
                onChange={(event) => setRenameTo(event.target.value)}
                onBlur={() => setRenaming(null)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    setRenaming(null);
                    return;
                  }
                  if (event.key !== 'Enter') return;

                  const next = renameTo.trim();
                  setRenaming(null);
                  if (next && next !== node.path) void rename(chatId, node.path, next);
                }}
                aria-label={`Новое имя для ${node.name}`}
              />
            ) : (
              <button
                type="button"
                className="file-row"
                data-active={selected === node.path}
                onClick={() => open(selected === node.path ? null : node.path)}
                title={`${originLabel[node.origin]} · ${fullWhen(node.updatedAt)}`}
              >
                <span className="file-name">{node.path}</span>
                <span className="label">{formatBytes(node.size)}</span>
              </button>
            )}

            {selected === node.path && renaming !== node.path && (
              <div className="file-ops">
                <button
                  type="button"
                  className="btn btn-quiet btn-icon"
                  aria-label="Скачать"
                  onClick={() =>
                    void contentOf(node.path).then((text) =>
                      saveSource(node.name, {
                        dataUrl: node.dataUrl,
                        text: text ?? node.text,
                        mediaType: node.mediaType,
                      }),
                    )
                  }
                >
                  <svg width="13" height="13" viewBox="0 0 13 13" aria-hidden="true">
                    <path d="M6.5 1.5v7M6.5 8.5 3.5 5.5M6.5 8.5l3-3M2 11.5h9" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                <button
                  type="button"
                  className="btn btn-quiet btn-icon"
                  aria-label="Переименовать"
                  onClick={() => {
                    setRenaming(node.path);
                    setRenameTo(node.path);
                  }}
                >
                  <svg width="13" height="13" viewBox="0 0 13 13" aria-hidden="true">
                    <path d="M9 1.8 11.2 4 4.6 10.6 1.8 11.2l.6-2.8Z" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinejoin="round" />
                  </svg>
                </button>
                <button
                  type="button"
                  className="btn btn-quiet btn-icon"
                  aria-label="Удалить"
                  onClick={() => void remove(chatId, node.path)}
                >
                  <svg width="13" height="13" viewBox="0 0 13 13" aria-hidden="true">
                    <path d="M2.5 3.5h8M5 3.5V2h3v1.5M3.8 3.5l.5 7.2h4.4l.5-7.2" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {current && (
        <div className="work-preview">
          <div className="row-between work-preview-head">
            <span className="label mono">{current.path}</span>
            <span className="label">{originLabel[current.origin]}</span>
          </div>
          <Preview node={current} />
        </div>
      )}
    </div>
  );
}

function Terminal() {
  const chatId = useChatStore((state) => state.activeId);
  const lines = useWorkspace((state) => state.terminal);
  const clear = useWorkspace((state) => state.clearTerminal);
  const tail = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = tail.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [lines]);

  return (
    <div className="work-body">
      <div className="work-actions">
        <span className="label">
          {lines.length ? `${lines.length} ${plural(lines.length, 'строка', 'строки', 'строк')}` : 'вывода пока нет'}
        </span>
        <button
          type="button"
          className="btn btn-quiet"
          onClick={() => chatId && void clear(chatId)}
          disabled={!lines.length}
        >
          очистить
        </button>
      </div>

      <div className="terminal" ref={tail}>
        {lines.length === 0 && (
          <p className="terminal-line terminal-sys">
            Здесь появляется вывод команд: модель исполняет код в песочнице этого разговора, а команды,
            меняющие окружение, ждут вашего разрешения.
          </p>
        )}

        {lines.map((line) => (
          <p className={`terminal-line terminal-${line.stream}`} key={line.id}>
            {line.text}
          </p>
        ))}
      </div>
    </div>
  );
}

export function WorkPanel() {
  const [tab, setTab] = useState<Tab>('files');
  const nodes = useWorkspace((state) => state.nodes);
  const lines = useWorkspace((state) => state.terminal);

  const seen = useRef(lines.length);

  useEffect(() => {
    if (lines.length > seen.current) setTab('terminal');
    seen.current = lines.length;
  }, [lines.length]);

  return (
    <div className="work-inner">
      <div className="work-head">
        <div className="segmented" role="group" aria-label="Раздел рабочей панели">
          <button type="button" data-on={tab === 'files'} aria-pressed={tab === 'files'} onClick={() => setTab('files')}>
            файлы {nodes.length > 0 && <span className="mono">{nodes.length}</span>}
          </button>
          <button
            type="button"
            data-on={tab === 'terminal'}
            aria-pressed={tab === 'terminal'}
            onClick={() => setTab('terminal')}
          >
            вывод
          </button>
        </div>
      </div>

      {tab === 'files' ? <FileList /> : <Terminal />}
    </div>
  );
}
