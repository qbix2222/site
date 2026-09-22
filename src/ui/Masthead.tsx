import { useAccounts } from '../store/accounts-store';
import { useChatStore } from '../store/chat-store';
import { useSettings } from '../store/settings-store';
import type { RuntimeKind } from '../core/types';

export interface MastheadProps {
  runtimeKind: RuntimeKind;
  runtimeNote: string | null;
  workOpen: boolean;
  onOpenRail(): void;
  onToggleWork(): void;
  onOpenSettings(): void;
}

const runtimeChip = (kind: RuntimeKind): { text: string; className: string } => {
  if (kind === 'webcontainer') return { text: 'песочница node', className: 'chip chip-live' };
  if (kind === 'local') return { text: 'локальный js', className: 'chip' };
  return { text: 'без исполнения', className: 'chip chip-danger' };
};

export function Masthead({
  runtimeKind,
  runtimeNote,
  workOpen,
  onOpenRail,
  onToggleWork,
  onOpenSettings,
}: MastheadProps) {
  const models = useAccounts((state) => state.models);
  const sessions = useChatStore((state) => state.sessions);
  const activeId = useChatStore((state) => state.activeId);
  const status = useChatStore((state) => state.status);
  const update = useChatStore((state) => state.update);
  const session = sessions.find((item) => item.id === activeId) ?? null;
  const theme = useSettings((state) => state.theme);
  const patch = useSettings((state) => state.patch);
  const chip = runtimeChip(runtimeKind);

  return (
    <header className="masthead">
      <button
        type="button"
        className="btn btn-quiet btn-icon only-narrow"
        onClick={onOpenRail}
        aria-label="Список разговоров"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M2 4h12M2 8h12M2 12h8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </button>

      <span className="wordmark">Пульт</span>

      <div className="masthead-model">
        <select
          className="field field-mono masthead-select"
          value={session?.modelKey ?? ''}
          disabled={!session || !models.length}
          onChange={(event) => {
            if (session) void update(session.id, { modelKey: event.target.value });
          }}
          aria-label="Модель этого разговора"
        >
          {!models.length && <option value="">нет подключённых моделей</option>}
          {models.map((model) => (
            <option key={model.key} value={model.key}>
              {model.name}
            </option>
          ))}
        </select>
      </div>

      <div className="row masthead-right">
        {status.phase !== 'idle' && (
          <span className="chip chip-truncate" title={status.note}>
            <span className={status.phase === 'streaming' ? 'dot dot-busy' : 'dot'} />
            {status.note || status.phase}
          </span>
        )}

        <span className={chip.className} title={runtimeNote ?? undefined}>
          {chip.text}
        </span>

        <button
          type="button"
          className="btn btn-quiet btn-icon"
          onClick={() => void patch({ theme: theme === 'dark' ? 'light' : 'dark' })}
          aria-label={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
        >
          {theme === 'dark' ? (
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="8" cy="8" r="3.2" stroke="currentColor" strokeWidth="1.3" fill="none" />
              <path
                d="M8 1.4v1.8M8 12.8v1.8M1.4 8h1.8M12.8 8h1.8M3.3 3.3l1.3 1.3M11.4 11.4l1.3 1.3M12.7 3.3l-1.3 1.3M4.6 11.4l-1.3 1.3"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
              />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <path
                d="M13.2 9.6A5.6 5.6 0 0 1 6.4 2.8a5.6 5.6 0 1 0 6.8 6.8Z"
                stroke="currentColor"
                strokeWidth="1.3"
                fill="none"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </button>

        <button
          type="button"
          className="btn btn-quiet btn-icon only-wide"
          onClick={onToggleWork}
          aria-pressed={workOpen}
          aria-label="Рабочая панель"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <rect x="1.8" y="2.8" width="12.4" height="10.4" rx="1" stroke="currentColor" strokeWidth="1.3" fill="none" />
            <path d="M10 2.8v10.4" stroke="currentColor" strokeWidth="1.3" />
          </svg>
        </button>

        <button
          type="button"
          className="btn btn-quiet btn-icon"
          onClick={onOpenSettings}
          aria-label="Настройки"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="8" cy="8" r="2.1" stroke="currentColor" strokeWidth="1.3" fill="none" />
            <path
              d="M8 1.6v1.7M8 12.7v1.7M14.4 8h-1.7M3.3 8H1.6M12.5 3.5l-1.2 1.2M4.7 11.3l-1.2 1.2M12.5 12.5l-1.2-1.2M4.7 4.7 3.5 3.5"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>
    </header>
  );
}
