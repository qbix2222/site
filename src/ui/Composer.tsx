import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Attachment, PersonaId } from '../core/types';
import { personas } from '../agent/instructions';
import { pushNotice, toAttachment, useChatStore } from '../store/chat-store';
import { useSettings } from '../store/settings-store';
import { useWorkspace } from '../store/workspace-store';
import { formatBytes } from '../workspace/summary';

export interface ComposerProps {
  draft: string;
  onDraft(text: string): void;
  onEditInstructions(): void;
  onOpenWork(): void;
}

const personaList = Object.entries(personas) as Array<[PersonaId, { title: string }]>;

export function Composer({ draft, onDraft, onEditInstructions, onOpenWork }: ComposerProps) {
  const box = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const send = useChatStore((state) => state.send);
  const stop = useChatStore((state) => state.stop);
  const regenerate = useChatStore((state) => state.regenerate);
  const status = useChatStore((state) => state.status);
  const sessions = useChatStore((state) => state.sessions);
  const activeId = useChatStore((state) => state.activeId);
  const update = useChatStore((state) => state.update);
  const sendOnEnter = useSettings((state) => state.sendOnEnter);
  const fileTotal = useWorkspace((state) => state.nodes.length);

  const session = sessions.find((item) => item.id === activeId) ?? null;
  const streaming = status.phase === 'streaming' || status.phase === 'preparing' || status.phase === 'retrying';

  useLayoutEffect(() => {
    const node = box.current;
    if (!node) return;

    node.style.height = 'auto';
    node.style.height = `${Math.min(node.scrollHeight, window.innerHeight * 0.4)}px`;
  }, [draft]);

  const attach = useCallback(async (files: File[]): Promise<void> => {
    setBusy(true);

    try {
      const next = await Promise.all(files.map(toAttachment));
      setAttachments((current) => [...current, ...next]);
    } catch (error) {
      pushNotice(
        error instanceof Error ? error.message : 'Не удалось прочитать файл',
        'danger',
      );
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const files = [...(event.clipboardData?.files ?? [])];
      if (!files.length) return;

      event.preventDefault();
      void attach(files);
    };

    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [attach]);

  async function submit(): Promise<void> {
    const text = draft.trim();
    if ((!text && !attachments.length) || streaming) return;

    const payload = attachments;
    setAttachments([]);
    onDraft('');

    await send(text, payload);
    box.current?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === 'Escape' && attachments.length) {
      setAttachments([]);
      return;
    }

    if (event.key !== 'Enter') return;

    const wantsSend = sendOnEnter ? !event.shiftKey : event.metaKey || event.ctrlKey;
    if (!wantsSend) return;

    event.preventDefault();
    void submit();
  }

  if (!session) return null;

  return (
    <form
      className={`composer${dragOver ? ' composer-drag' : ''}`}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      onDragOver={(event) => {
        event.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragOver(false);
        void attach([...event.dataTransfer.files]);
      }}
    >
      <div className="composer-inner">
        {attachments.length > 0 && (
          <div className="attachment-row">
            {attachments.map((item) => (
              <span className="attachment" key={item.id}>
                {item.kind === 'image' && <img src={item.dataUrl} alt="" />}
                <span className="attachment-name">{item.name}</span>
                <span className="label">{formatBytes(item.size)}</span>
                <button
                  type="button"
                  className="btn btn-quiet btn-icon"
                  aria-label={`Убрать ${item.name}`}
                  onClick={() => setAttachments((current) => current.filter((file) => file.id !== item.id))}
                >
                  <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                    <path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                  </svg>
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="composer-box">
          <textarea
            ref={box}
            className="composer-input"
            rows={1}
            value={draft}
            placeholder={streaming ? 'идёт ответ…' : 'Сообщение'}
            onChange={(event) => onDraft(event.target.value)}
            onKeyDown={onKeyDown}
            aria-label="Текст сообщения"
          />

          {streaming ? (
            <button type="button" className="btn btn-icon" onClick={() => void stop()} aria-label="Остановить">
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                <rect x="2" y="2" width="8" height="8" rx="1" fill="currentColor" />
              </svg>
            </button>
          ) : (
            <button
              type="submit"
              className="btn btn-signal btn-icon"
              disabled={busy || (!draft.trim() && !attachments.length)}
              aria-label="Отправить"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                <path d="M7 12V2M7 2 3 6M7 2l4 4" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
        </div>

        <div className="composer-tools">
          <div className="row">
            <input
              ref={picker}
              type="file"
              multiple
              className="sr-only"
              onChange={(event) => {
                const files = [...(event.target.files ?? [])];
                if (files.length) void attach(files);
                event.target.value = '';
              }}
            />

            <button type="button" className="btn btn-quiet" onClick={() => picker.current?.click()}>
              файл
            </button>

            <button
              type="button"
              className="btn btn-quiet only-narrow"
              onClick={onOpenWork}
              title="Рабочая папка разговора и вывод команд"
            >
              папка{fileTotal > 0 ? ` ${fileTotal}` : ''}
            </button>

            <select
              className="field field-mono composer-select"
              value={session.persona}
              onChange={(event) => void update(session.id, { persona: event.target.value as PersonaId })}
              aria-label="Роль модели"
            >
              {personaList.map(([id, persona]) => (
                <option key={id} value={id}>
                  {persona.title}
                </option>
              ))}
            </select>

            <button type="button" className="btn btn-quiet" onClick={onEditInstructions}>
              указания
              {session.instructions ? ' •' : ''}
            </button>
          </div>

          <div className="row">
            {!streaming && (
              <button type="button" className="btn btn-quiet" onClick={() => void regenerate()}>
                повторить
              </button>
            )}
            <span className="label">
              {sendOnEnter ? 'enter — отправить, shift+enter — строка' : 'ctrl+enter — отправить'}
            </span>
          </div>
        </div>
      </div>
    </form>
  );
}
